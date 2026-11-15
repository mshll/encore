import { createHash } from "node:crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { randomId, safeEqual, sha256 } from "../auth/secrets";
import type { Db, Tx } from "../db/client";
import { oauthClients, oauthCodes, oauthGrants, oauthTokens } from "../db/schema";
import { canonicalResource, isLoopbackUri, matchesRedirectUri, redirectUriProblem } from "./uris";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const ACCESS_TOKEN_TTL_MS = 60 * MINUTE;
export const REFRESH_TOKEN_TTL_MS = 30 * DAY;
export const CODE_TTL_MS = 2 * MINUTE;
export const REQUEST_TTL_MS = 10 * MINUTE;
/** A registered client that never connected is deleted after this long. */
export const UNUSED_CLIENT_TTL_MS = 7 * DAY;
const LAST_USED_RESOLUTION_MS = MINUTE;
const MAX_PENDING_REQUESTS = 1000;

export const MCP_SCOPE = "mcp";
export const SCOPES = [MCP_SCOPE, "offline_access"] as const;

/** An OAuth error response (RFC 6749 section 5.2, RFC 7591 section 3.2.2), answered as `{ error, error_description }`. */
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 = 400,
  ) {
    super(message);
  }
}

export type RegisteredClient = {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
};

export type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

export type AuthorizeOutcome =
  | { kind: "consent"; requestId: string }
  | { kind: "redirect"; location: string }
  /** Unknown client or a redirect URI it did not register: the owner sees the error, nothing is redirected. */
  | { kind: "invalid"; message: string };

export type ConsentRequest = { clientName: string; redirectHost: string; loopback: boolean };

export type Connection = { id: number; clientName: string; redirectHost: string; connectedAt: number; lastUsedAt: number | null };

export type AccessGrant = { grantId: number; clientId: string; scope: string; resource: string; expiresAt: number };

type PendingRequest = { clientId: string; redirectUri: string; codeChallenge: string; scope: string; resource: string; state?: string; expiresAt: number };

const registration = z
  .object({
    redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
    client_name: z.string().max(500).optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
  })
  .loose();

const GRANT_TYPES = ["authorization_code", "refresh_token"];
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

const hash = (value: string) => sha256(value).toString("hex");
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const hostOf = (uri: string) => new URL(uri).host;
const cleanName = (name: string | undefined) => name?.replace(/\p{Cc}/gu, "").trim().slice(0, 100) || "Unnamed client";

/**
 * The OAuth 2.1 authorization server for `/mcp`: dynamic client registration, authorization code with PKCE (S256),
 * rotating refresh tokens, revocation. One owner, one resource. Codes and tokens are stored only as SHA-256 hashes.
 */
export class OAuthServer {
  private readonly pending = new Map<string, PendingRequest>();
  readonly resource: string;

  constructor(
    private readonly db: Db,
    readonly issuer: string,
    private readonly now: () => number = Date.now,
  ) {
    this.resource = canonicalResource(`${issuer}/mcp`)!;
  }

  register(body: unknown): RegisteredClient {
    const parsed = registration.safeParse(body);
    if (!parsed.success) throw new OAuthError("invalid_client_metadata", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const meta = parsed.data;
    for (const uri of meta.redirect_uris) {
      const problem = redirectUriProblem(uri);
      if (problem) throw new OAuthError("invalid_redirect_uri", `${uri}: ${problem}`);
    }
    if (meta.grant_types?.some((g) => !GRANT_TYPES.includes(g))) throw new OAuthError("invalid_client_metadata", "Only authorization_code and refresh_token grants are supported");
    if (meta.response_types?.some((r) => r !== "code")) throw new OAuthError("invalid_client_metadata", "Only the code response type is supported");
    const now = this.now();
    this.db
      .delete(oauthClients)
      .where(and(lt(oauthClients.createdAt, now - UNUSED_CLIENT_TTL_MS), sql`not exists (select 1 from ${oauthGrants} where ${oauthGrants.clientId} = ${oauthClients.id})`))
      .run();
    const client = { id: randomId(24), name: cleanName(meta.client_name), redirectUris: meta.redirect_uris, createdAt: now };
    this.db.insert(oauthClients).values(client).run();
    return {
      client_id: client.id,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: GRANT_TYPES,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  authorize(params: Record<string, string | undefined>): AuthorizeOutcome {
    const client = params.client_id ? this.db.select().from(oauthClients).where(eq(oauthClients.id, params.client_id)).get() : undefined;
    if (!client) return { kind: "invalid", message: "This app is not registered with encore. Remove it and add it again." };
    const redirectUri = params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (!redirectUri || !matchesRedirectUri(client.redirectUris, redirectUri)) return { kind: "invalid", message: "The app sent a redirect address it did not register." };
    const fail = (error: string, description: string): AuthorizeOutcome => ({ kind: "redirect", location: this.redirect(redirectUri, { error, error_description: description, state: params.state }) });
    if (params.response_type !== "code") return fail("unsupported_response_type", "Only response_type=code is supported");
    if (params.code_challenge_method !== "S256" || !params.code_challenge || !PKCE_CHALLENGE.test(params.code_challenge)) return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
    if (params.resource !== undefined && canonicalResource(params.resource) !== this.resource) return fail("invalid_target", `The resource must be ${this.resource}`);
    const scope = this.scope(params.scope);
    if (scope === null) return fail("invalid_scope", `Supported scopes: ${SCOPES.join(" ")}`);
    const now = this.now();
    for (const [key, value] of this.pending) {
      if (value.expiresAt >= now && this.pending.size < MAX_PENDING_REQUESTS) break;
      this.pending.delete(key);
    }
    const requestId = randomId();
    this.pending.set(requestId, { clientId: client.id, redirectUri, codeChallenge: params.code_challenge, scope, resource: this.resource, state: params.state, expiresAt: now + REQUEST_TTL_MS });
    return { kind: "consent", requestId };
  }

  consentRequest(requestId: string): ConsentRequest | null {
    const request = this.openRequest(requestId);
    if (!request) return null;
    const client = this.db.select({ name: oauthClients.name }).from(oauthClients).where(eq(oauthClients.id, request.clientId)).get();
    if (!client) return null;
    return { clientName: client.name, redirectHost: hostOf(request.redirectUri), loopback: isLoopbackUri(request.redirectUri) };
  }

  /** The owner's answer. Returns where to send the browser, or null when the request expired or was already answered. */
  decide(requestId: string, allow: boolean): string | null {
    const request = this.openRequest(requestId);
    this.pending.delete(requestId);
    if (!request) return null;
    if (!allow) return this.redirect(request.redirectUri, { error: "access_denied", error_description: "The owner declined", state: request.state });
    const code = randomId();
    this.db
      .insert(oauthCodes)
      .values({
        codeHash: hash(code),
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        scope: request.scope,
        resource: request.resource,
        expiresAt: this.now() + CODE_TTL_MS,
      })
      .run();
    return this.redirect(request.redirectUri, { code, state: request.state });
  }

  token(params: Record<string, string | undefined>): TokenResponse {
    const clientId = params.client_id;
    if (!clientId) throw new OAuthError("invalid_client", "client_id is required", 401);
    if (params.grant_type === "refresh_token") return this.refresh(clientId, params);
    if (params.grant_type === "authorization_code") {
      const client = this.db.select({ id: oauthClients.id }).from(oauthClients).where(eq(oauthClients.id, clientId)).get();
      if (!client) throw new OAuthError("invalid_client", "Unknown client_id", 401);
      return this.exchangeCode(client.id, params);
    }
    throw new OAuthError("unsupported_grant_type", "Supported grant types: authorization_code, refresh_token");
  }

  /** RFC 7009. Revoking a refresh token ends the whole connection; an unknown token is not an error. */
  revoke(params: Record<string, string | undefined>): void {
    if (!params.token || !params.client_id) return;
    const row = this.db
      .select({ grantId: oauthTokens.grantId, kind: oauthTokens.kind, clientId: oauthGrants.clientId })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
      .where(eq(oauthTokens.tokenHash, hash(params.token)))
      .get();
    if (!row || row.clientId !== params.client_id) return;
    if (row.kind === "refresh") this.db.delete(oauthGrants).where(eq(oauthGrants.id, row.grantId)).run();
    else this.db.delete(oauthTokens).where(eq(oauthTokens.tokenHash, hash(params.token))).run();
  }

  /** The grant behind a live access token issued for `/mcp`, or null. Records when the connection was last used. */
  verifyAccessToken(token: string): AccessGrant | null {
    const now = this.now();
    const row = this.db
      .select({ grantId: oauthGrants.id, clientId: oauthGrants.clientId, scope: oauthGrants.scope, resource: oauthGrants.resource, lastUsedAt: oauthGrants.lastUsedAt, expiresAt: oauthTokens.expiresAt, kind: oauthTokens.kind })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
      .where(eq(oauthTokens.tokenHash, hash(token)))
      .get();
    if (!row || row.kind !== "access" || row.expiresAt <= now || row.resource !== this.resource) return null;
    if (row.lastUsedAt === null || now - row.lastUsedAt >= LAST_USED_RESOLUTION_MS) this.db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, row.grantId)).run();
    return { grantId: row.grantId, clientId: row.clientId, scope: row.scope, resource: row.resource, expiresAt: row.expiresAt };
  }

  connections(): Connection[] {
    return this.db
      .select({ id: oauthGrants.id, clientName: oauthClients.name, redirectUri: oauthGrants.redirectUri, connectedAt: oauthGrants.createdAt, lastUsedAt: oauthGrants.lastUsedAt })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .orderBy(desc(oauthGrants.createdAt))
      .all()
      .map(({ redirectUri, ...c }) => ({ ...c, redirectHost: hostOf(redirectUri) }));
  }

  /** Deletes the connection and with it every token it holds. */
  disconnect(grantId: number): boolean {
    return this.db.delete(oauthGrants).where(eq(oauthGrants.id, grantId)).returning({ id: oauthGrants.id }).all().length > 0;
  }

  private exchangeCode(clientId: string, params: Record<string, string | undefined>): TokenResponse {
    if (!params.code || !params.code_verifier) throw new OAuthError("invalid_request", "code and code_verifier are required");
    const now = this.now();
    const outcome = this.db.transaction((tx): TokenResponse | OAuthError => {
      const code = tx.select().from(oauthCodes).where(eq(oauthCodes.codeHash, hash(params.code!))).get();
      if (!code || code.clientId !== clientId) throw new OAuthError("invalid_grant", "Unknown authorization code");
      if (code.usedAt !== null) {
        if (code.grantId !== null) tx.delete(oauthGrants).where(eq(oauthGrants.id, code.grantId)).run();
        return new OAuthError("invalid_grant", "Authorization code was already used; the tokens it issued are revoked");
      }
      if (code.expiresAt <= now) throw new OAuthError("invalid_grant", "Authorization code expired");
      if (params.redirect_uri !== undefined && params.redirect_uri !== code.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request");
      if (params.resource !== undefined && canonicalResource(params.resource) !== code.resource) throw new OAuthError("invalid_target", `The resource must be ${code.resource}`);
      if (!PKCE_VERIFIER.test(params.code_verifier!) || !safeEqual(s256(params.code_verifier!), code.codeChallenge)) throw new OAuthError("invalid_grant", "code_verifier does not match the code challenge");
      const grant = tx
        .insert(oauthGrants)
        .values({ clientId, redirectUri: code.redirectUri, scope: code.scope, resource: code.resource, createdAt: now })
        .returning({ id: oauthGrants.id })
        .get();
      tx.update(oauthCodes).set({ usedAt: now, grantId: grant.id }).where(eq(oauthCodes.codeHash, code.codeHash)).run();
      tx.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now - DAY)).run();
      return this.issue(tx, grant.id, code.scope, now);
    });
    if (outcome instanceof OAuthError) throw outcome;
    return outcome;
  }

  private refresh(clientId: string, params: Record<string, string | undefined>): TokenResponse {
    if (!params.refresh_token) throw new OAuthError("invalid_request", "refresh_token is required");
    const now = this.now();
    return this.db.transaction((tx) => {
      const tokenHash = hash(params.refresh_token!);
      const row = tx
        .select({ grantId: oauthGrants.id, clientId: oauthGrants.clientId, scope: oauthGrants.scope, resource: oauthGrants.resource, kind: oauthTokens.kind, expiresAt: oauthTokens.expiresAt })
        .from(oauthTokens)
        .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
        .where(eq(oauthTokens.tokenHash, tokenHash))
        .get();
      if (!row || row.kind !== "refresh" || row.clientId !== clientId || row.expiresAt <= now) throw new OAuthError("invalid_grant", "Refresh token is invalid, expired or revoked");
      if (params.resource !== undefined && canonicalResource(params.resource) !== row.resource) throw new OAuthError("invalid_target", `The resource must be ${row.resource}`);
      const requested = params.scope === undefined ? row.scope : this.scope(params.scope);
      if (requested === null || requested.split(" ").some((s) => !row.scope.split(" ").includes(s))) throw new OAuthError("invalid_scope", "A refresh cannot widen the scope");
      tx.delete(oauthTokens).where(eq(oauthTokens.tokenHash, tokenHash)).run();
      return this.issue(tx, row.grantId, requested, now);
    });
  }

  private issue(tx: Tx, grantId: number, scope: string, now: number): TokenResponse {
    tx.delete(oauthTokens).where(lt(oauthTokens.expiresAt, now)).run();
    const access = randomId();
    const refresh = randomId();
    tx.insert(oauthTokens)
      .values([
        { tokenHash: hash(access), grantId, kind: "access", expiresAt: now + ACCESS_TOKEN_TTL_MS },
        { tokenHash: hash(refresh), grantId, kind: "refresh", expiresAt: now + REFRESH_TOKEN_TTL_MS },
      ])
      .run();
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_MS / 1000, refresh_token: refresh, scope };
  }

  /** The requested scope, normalised, or null when it names a scope encore does not know. No scope means `mcp`. */
  private scope(requested: string | undefined): string | null {
    const scopes = (requested ?? "").split(" ").filter(Boolean);
    if (scopes.some((s) => !(SCOPES as readonly string[]).includes(s))) return null;
    return SCOPES.filter((s) => s === MCP_SCOPE || scopes.includes(s)).join(" ");
  }

  private openRequest(requestId: string): PendingRequest | null {
    const request = this.pending.get(requestId);
    return request && request.expiresAt > this.now() ? request : null;
  }

  private redirect(uri: string, params: Record<string, string | undefined>): string {
    const url = new URL(uri);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
    url.searchParams.set("iss", this.issuer);
    return url.href;
  }
}
