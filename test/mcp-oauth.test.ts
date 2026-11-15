import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { createSession } from "../src/auth/sessions";
import { MCP_TOOLS } from "../src/mcp/server";
import { ACCESS_TOKEN_TTL_MS, CODE_TTL_MS, OAuthError, OAuthServer, REFRESH_TOKEN_TTL_MS, REQUEST_TTL_MS } from "../src/oauth/server";
import { canonicalResource, matchesRedirectUri, redirectUriProblem } from "../src/oauth/uris";
import { play, seed, testApp, testDb, track, uri } from "./helpers";

const BASE = "http://localhost:8888";
const RESOURCE = `${BASE}/mcp`;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const STATIC = "mcp-token-mcp-token-mcp-token";
const SAME_ORIGIN = { origin: BASE, "content-type": "application/json" };

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};
const form = (fields: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });
const rpc = (method: string, params: unknown = {}, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const mcpHeaders = (token: string) => ({ "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" });

async function rpcResult(res: Response) {
  const text = await res.text();
  const data = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data: "))!.slice(6);
  return JSON.parse(data) as { result?: { tools?: { name: string }[]; content?: { text: string }[] } };
}

function oauthApp(env: Record<string, string> = {}) {
  const t = testApp({ MCP_OAUTH: "true", ...env });
  const cookie = `encore_session=${createSession(t.db)}`;
  const register = async (body: unknown = { client_name: "Claude", redirect_uris: [CALLBACK] }) =>
    t.app.request("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const authorizeUrl = (clientId: string, challenge: string, extra: Record<string, string> = {}) =>
    `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "st-1", resource: RESOURCE, scope: "mcp", ...extra })}`;

  /** Register, authorize, allow on the consent page: returns the client id, the code and the PKCE verifier. */
  async function authorizeCode() {
    const client = (await (await register()).json()) as { client_id: string };
    const { verifier, challenge } = pkce();
    const start = await t.app.request(authorizeUrl(client.client_id, challenge));
    const requestId = start.headers.get("location")!.split("/").pop()!;
    const decided = await t.app.request(`/api/mcp/requests/${requestId}`, { method: "POST", headers: { ...SAME_ORIGIN, cookie }, body: JSON.stringify({ decision: "allow" }) });
    const redirectTo = new URL(((await decided.json()) as { redirectTo: string }).redirectTo);
    return { clientId: client.client_id, code: redirectTo.searchParams.get("code")!, verifier };
  }
  const exchange = (clientId: string, code: string, verifier: string, extra: Record<string, string> = {}) =>
    t.app.request("/oauth/token", form({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: CALLBACK, resource: RESOURCE, ...extra }));
  const refresh = (clientId: string, token: string) => t.app.request("/oauth/token", form({ grant_type: "refresh_token", client_id: clientId, refresh_token: token, resource: RESOURCE }));
  const callTool = (token: string) => t.app.request("/mcp", { method: "POST", headers: mcpHeaders(token), body: rpc("tools/call", { name: "overview", arguments: {} }) });
  return { ...t, cookie, register, authorizeUrl, authorizeCode, exchange, refresh, callTool };
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };

describe("redirect and resource rules", () => {
  test("https and loopback http register; other http, custom schemes and fragments do not", () => {
    expect(redirectUriProblem(CALLBACK)).toBeNull();
    expect(redirectUriProblem("http://localhost/callback")).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1:3118/callback")).toBeNull();
    expect(redirectUriProblem("http://[::1]/cb")).toBeNull();
    expect(redirectUriProblem("http://evil.example/callback")).toContain("http is allowed only");
    expect(redirectUriProblem("myapp://callback")).toBe("must use https");
    expect(redirectUriProblem("https://claude.ai/cb#x")).toBe("must not have a fragment");
    expect(redirectUriProblem("not a url")).toBe("not an absolute URL");
  });

  test("redirect URIs match exactly, except the port of a loopback URI", () => {
    expect(matchesRedirectUri([CALLBACK], CALLBACK)).toBe(true);
    expect(matchesRedirectUri([CALLBACK], `${CALLBACK}/`)).toBe(false);
    expect(matchesRedirectUri([CALLBACK], "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
    expect(matchesRedirectUri(["http://localhost/callback"], "http://localhost:3118/callback")).toBe(true);
    expect(matchesRedirectUri(["http://127.0.0.1/callback"], "http://127.0.0.1:50000/callback")).toBe(true);
    expect(matchesRedirectUri(["http://localhost/callback"], "http://localhost:3118/other")).toBe(false);
    expect(matchesRedirectUri(["https://example.com/cb"], "https://example.com:8443/cb")).toBe(false);
  });

  test("the resource is compared in canonical form", () => {
    expect(canonicalResource("HTTPS://Encore.Example:443/mcp/")).toBe("https://encore.example/mcp");
    expect(canonicalResource("https://encore.example/mcp#x")).toBe("https://encore.example/mcp");
  });
});

describe("OAuth server", () => {
  let now = 1_800_000_000_000;
  const server = () => new OAuthServer(testDb(), "https://encore.example", () => now);
  const authorize = (s: OAuthServer, clientId: string, challenge: string) =>
    s.authorize({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "s", resource: "https://encore.example/mcp" });
  const code = (s: OAuthServer, clientId: string, challenge: string) => {
    const outcome = authorize(s, clientId, challenge);
    if (outcome.kind !== "consent") throw new Error(outcome.kind);
    return new URL(s.decide(outcome.requestId, true)!).searchParams.get("code")!;
  };
  const expectOAuthError = (run: () => unknown, code: string) => {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthError);
      expect((error as OAuthError).code).toBe(code);
      return;
    }
    throw new Error(`expected ${code}`);
  };

  test("a code expires after its lifetime", () => {
    const s = server();
    const { client_id } = s.register({ redirect_uris: [CALLBACK] });
    const { verifier, challenge } = pkce();
    const c = code(s, client_id, challenge);
    now += CODE_TTL_MS + 1;
    expectOAuthError(() => s.token({ grant_type: "authorization_code", client_id, code: c, code_verifier: verifier }), "invalid_grant");
  });

  test("an access token stops working when it expires, a refresh token when it expires", () => {
    const s = server();
    const { client_id } = s.register({ redirect_uris: [CALLBACK] });
    const { verifier, challenge } = pkce();
    const tokens = s.token({ grant_type: "authorization_code", client_id, code: code(s, client_id, challenge), code_verifier: verifier });
    expect(s.verifyAccessToken(tokens.access_token)).not.toBeNull();
    expect(s.verifyAccessToken(tokens.refresh_token)).toBeNull();
    now += ACCESS_TOKEN_TTL_MS;
    expect(s.verifyAccessToken(tokens.access_token)).toBeNull();
    now += REFRESH_TOKEN_TTL_MS;
    expectOAuthError(() => s.token({ grant_type: "refresh_token", client_id, refresh_token: tokens.refresh_token }), "invalid_grant");
  });

  test("a consent request expires and can be answered once", () => {
    const s = server();
    const { client_id } = s.register({ redirect_uris: [CALLBACK] });
    const first = authorize(s, client_id, pkce().challenge);
    const second = authorize(s, client_id, pkce().challenge);
    if (first.kind !== "consent" || second.kind !== "consent") throw new Error("expected consent");
    expect(s.decide(first.requestId, false)).toContain("error=access_denied");
    expect(s.decide(first.requestId, true)).toBeNull();
    now += REQUEST_TTL_MS + 1;
    expect(s.consentRequest(second.requestId)).toBeNull();
    expect(s.decide(second.requestId, true)).toBeNull();
  });

  test("only the client a token belongs to can revoke it, and revoking a refresh token ends the connection", () => {
    const s = server();
    const { client_id } = s.register({ redirect_uris: [CALLBACK] });
    const other = s.register({ redirect_uris: [CALLBACK] }).client_id;
    const { verifier, challenge } = pkce();
    const tokens = s.token({ grant_type: "authorization_code", client_id, code: code(s, client_id, challenge), code_verifier: verifier });
    s.revoke({ token: tokens.refresh_token, client_id: other });
    expect(s.verifyAccessToken(tokens.access_token)).not.toBeNull();
    s.revoke({ token: tokens.refresh_token, client_id });
    expect(s.verifyAccessToken(tokens.access_token)).toBeNull();
    expect(s.connections()).toEqual([]);
  });

  test("a refresh from a client that no longer exists is invalid_grant, so the client signs in again", () => {
    const s = server();
    const { client_id } = s.register({ redirect_uris: [CALLBACK] });
    const { verifier, challenge } = pkce();
    const tokens = s.token({ grant_type: "authorization_code", client_id, code: code(s, client_id, challenge), code_verifier: verifier });
    s.disconnect(s.connections()[0]!.id);
    now += 8 * 86_400_000;
    s.register({ redirect_uris: [CALLBACK] });

    expectOAuthError(() => s.token({ grant_type: "refresh_token", client_id, refresh_token: tokens.refresh_token }), "invalid_grant");
  });

  test("clients that never connected are deleted a week after registration", () => {
    const s = server();
    const stale = s.register({ redirect_uris: [CALLBACK] }).client_id;
    now += 8 * 86_400_000;
    s.register({ redirect_uris: [CALLBACK] });
    expect(authorize(s, stale, pkce().challenge).kind).toBe("invalid");
  });
});

describe("MCP OAuth over HTTP", () => {
  test("is off by default: no metadata, no endpoints, and /mcp stays off without a token", async () => {
    const { app } = testApp();
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server"]) expect((await app.request(path)).status).toBe(404);
    expect((await app.request("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(404);
    expect((await app.request("/mcp", { method: "POST", body: rpc("initialize") })).status).toBe(404);
  });

  test("serves protected resource and authorization server metadata", async () => {
    const { app } = oauthApp();
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await app.request(path);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(await res.json()).toMatchObject({ resource: RESOURCE, authorization_servers: [BASE], scopes_supported: ["mcp"] });
    }
    expect(await (await app.request("/.well-known/oauth-authorization-server")).json()).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      registration_endpoint: `${BASE}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
    });
  });

  test("a 401 from /mcp points at the resource metadata when OAuth is on, and not otherwise", async () => {
    const { app } = oauthApp();
    const res = await app.request("/mcp", { method: "POST", body: rpc("initialize") });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp", scope="mcp"`);
    const wrong = await app.request("/mcp", { method: "POST", headers: { authorization: "Bearer nope" }, body: rpc("initialize") });
    expect(wrong.headers.get("www-authenticate")).toContain(`error="invalid_token"`);
    const tokenOnly = testApp({ MCP_TOKEN: STATIC });
    expect((await tokenOnly.app.request("/mcp", { method: "POST", body: rpc("initialize") })).headers.get("www-authenticate")).toBeNull();
  });

  test("full flow: register, authorize with PKCE, consent, token, tool call, refresh, disconnect", async () => {
    const t = oauthApp();
    seed(t.db, [track("a", "Song A", "Artist", "Album")], [play("2026-01-01T10:00:00Z", uri("a"), 200_000)]);
    const reg = await t.register();
    expect(reg.status).toBe(201);
    const client = (await reg.json()) as { client_id: string; token_endpoint_auth_method: string; client_secret?: string };
    expect(client.token_endpoint_auth_method).toBe("none");
    expect(client.client_secret).toBeUndefined();

    const { verifier, challenge } = pkce();
    const start = await t.app.request(t.authorizeUrl(client.client_id, challenge));
    expect(start.status).toBe(302);
    const consentPath = start.headers.get("location")!;
    expect(consentPath).toMatch(/^\/connect\/[A-Za-z0-9_-]+$/);
    const requestPath = `/api/mcp/requests/${consentPath.split("/").pop()}`;

    expect((await t.app.request(requestPath)).status).toBe(401);
    const consent = await t.app.request(requestPath, { headers: { cookie: t.cookie } });
    expect(await consent.json()).toEqual({ clientName: "Claude", redirectHost: "claude.ai", loopback: false, tools: MCP_TOOLS });

    const decided = await t.app.request(requestPath, { method: "POST", headers: { ...SAME_ORIGIN, cookie: t.cookie }, body: JSON.stringify({ decision: "allow" }) });
    const redirect = new URL(((await decided.json()) as { redirectTo: string }).redirectTo);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(CALLBACK);
    expect(redirect.searchParams.get("state")).toBe("st-1");
    expect(redirect.searchParams.get("iss")).toBe(BASE);

    const tokenRes = await t.exchange(client.client_id, redirect.searchParams.get("code")!, verifier);
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.headers.get("cache-control")).toBe("no-store");
    const tokens = (await tokenRes.json()) as Tokens;
    expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "mcp" });

    const call = await t.callTool(tokens.access_token);
    expect(call.status).toBe(200);
    expect(JSON.parse((await rpcResult(call)).result!.content![0]!.text)).toMatchObject({ plays: 1 });

    const refreshed = (await (await t.refresh(client.client_id, tokens.refresh_token)).json()) as Tokens;
    expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);
    expect((await t.callTool(refreshed.access_token)).status).toBe(200);
    const reused = await t.refresh(client.client_id, tokens.refresh_token);
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ error: "invalid_grant" });

    const list = (await (await t.app.request("/api/mcp/connections", { headers: { cookie: t.cookie } })).json()) as { connections: { id: number; clientName: string; redirectHost: string; lastUsedAt: string | null }[] };
    expect(list.connections).toHaveLength(1);
    expect(list.connections[0]).toMatchObject({ clientName: "Claude", redirectHost: "claude.ai" });
    expect(list.connections[0]!.lastUsedAt).not.toBeNull();

    const disconnect = await t.app.request(`/api/mcp/connections/${list.connections[0]!.id}`, { method: "DELETE", headers: { origin: BASE, cookie: t.cookie } });
    expect(await disconnect.json()).toEqual({ disconnected: true });
    expect((await t.callTool(refreshed.access_token)).status).toBe(401);
    expect(await (await t.refresh(client.client_id, refreshed.refresh_token)).json()).toMatchObject({ error: "invalid_grant" });
  });

  test("the static token keeps working next to OAuth", async () => {
    const t = oauthApp({ MCP_TOKEN: STATIC });
    expect((await t.callTool(STATIC)).status).toBe(200);
  });

  test("a denied consent sends access_denied back with the state", async () => {
    const t = oauthApp();
    const client = (await (await t.register()).json()) as { client_id: string };
    const start = await t.app.request(t.authorizeUrl(client.client_id, pkce().challenge));
    const res = await t.app.request(`/api/mcp/requests/${start.headers.get("location")!.split("/").pop()}`, {
      method: "POST",
      headers: { ...SAME_ORIGIN, cookie: t.cookie },
      body: JSON.stringify({ decision: "deny" }),
    });
    const redirect = new URL(((await res.json()) as { redirectTo: string }).redirectTo);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("st-1");
    expect(redirect.searchParams.get("code")).toBeNull();
  });

  test("a wrong code verifier is refused", async () => {
    const t = oauthApp();
    const { clientId, code } = await t.authorizeCode();
    const res = await t.exchange(clientId, code, pkce().verifier);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_grant" });
  });

  test("a code works once; using it again revokes the tokens it issued", async () => {
    const t = oauthApp();
    const { clientId, code, verifier } = await t.authorizeCode();
    const tokens = (await (await t.exchange(clientId, code, verifier)).json()) as Tokens;
    const again = await t.exchange(clientId, code, verifier);
    expect(await again.json()).toMatchObject({ error: "invalid_grant" });
    expect((await t.callTool(tokens.access_token)).status).toBe(401);
  });

  test("a code is bound to its client, redirect URI and resource", async () => {
    const t = oauthApp();
    const { clientId, code, verifier } = await t.authorizeCode();
    const other = (await (await t.register()).json()) as { client_id: string };
    expect(await (await t.exchange(other.client_id, code, verifier)).json()).toMatchObject({ error: "invalid_grant" });
    expect(await (await t.exchange(clientId, code, verifier, { redirect_uri: "https://claude.ai/other" })).json()).toMatchObject({ error: "invalid_grant" });
    expect(await (await t.exchange(clientId, code, verifier, { resource: "https://elsewhere.example/mcp" })).json()).toMatchObject({ error: "invalid_target" });
    expect((await t.exchange(clientId, code, verifier)).status).toBe(200);
  });

  test("an unknown client gets invalid_client and no redirect", async () => {
    const t = oauthApp();
    const res = await t.exchange("nobody", "code", pkce().verifier);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "invalid_client" });
    const page = await t.app.request(t.authorizeUrl("nobody", pkce().challenge));
    expect(page.status).toBe(400);
    expect(page.headers.get("location")).toBeNull();
  });

  test("authorize never redirects to a URI the client did not register", async () => {
    const t = oauthApp();
    const client = (await (await t.register()).json()) as { client_id: string };
    const res = await t.app.request(t.authorizeUrl(client.client_id, pkce().challenge, { redirect_uri: "https://evil.example/callback" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("did not register");
  });

  test("authorize requires S256 PKCE and the /mcp resource, and says so through the redirect", async () => {
    const t = oauthApp();
    const client = (await (await t.register()).json()) as { client_id: string };
    const errorOf = async (extra: Record<string, string>) => {
      const res = await t.app.request(t.authorizeUrl(client.client_id, pkce().challenge, extra));
      const location = new URL(res.headers.get("location")!);
      expect(location.searchParams.get("state")).toBe("st-1");
      return location.searchParams.get("error");
    };
    expect(await errorOf({ code_challenge_method: "plain" })).toBe("invalid_request");
    expect(await errorOf({ code_challenge: "short" })).toBe("invalid_request");
    expect(await errorOf({ resource: "https://elsewhere.example/mcp" })).toBe("invalid_target");
    expect(await errorOf({ scope: "admin" })).toBe("invalid_scope");
    expect(await errorOf({ response_type: "token" })).toBe("unsupported_response_type");
  });

  test("registration rejects http redirect URIs except loopback", async () => {
    const t = oauthApp();
    const bad = await t.register({ redirect_uris: ["http://evil.example/cb"] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_redirect_uri" });
    expect((await t.register({ redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"], client_name: "Claude Code" })).status).toBe(201);
    expect(await (await t.register({ redirect_uris: [] })).json()).toMatchObject({ error: "invalid_client_metadata" });
  });

  test("the consent answer must come from encore's own origin as JSON", async () => {
    const t = oauthApp();
    const client = (await (await t.register()).json()) as { client_id: string };
    const start = await t.app.request(t.authorizeUrl(client.client_id, pkce().challenge));
    const path = `/api/mcp/requests/${start.headers.get("location")!.split("/").pop()}`;
    const cross = await t.app.request(path, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json", cookie: t.cookie }, body: JSON.stringify({ decision: "allow" }) });
    expect(cross.status).toBe(403);
    const formPost = await t.app.request(path, { method: "POST", headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded", cookie: t.cookie }, body: "decision=allow" });
    expect(formPost.status).toBe(415);
    expect((await t.app.request(path, { headers: { cookie: t.cookie } })).status).toBe(200);
  });

  test("the consent page and its API cannot be framed", async () => {
    const t = oauthApp();
    for (const path of ["/connect/some-id", "/api/mcp/requests/some-id"]) {
      const res = await t.app.request(path, { headers: { cookie: t.cookie } });
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    }
  });

  test("the public OAuth endpoints are rate limited per client address", async () => {
    const t = oauthApp();
    const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await t.app.request("/oauth/register", { method: "POST", headers, body: JSON.stringify({ redirect_uris: [CALLBACK] }) })).status);
    expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect((await t.app.request("/oauth/register", { method: "POST", headers: { ...headers, "x-forwarded-for": "203.0.113.10" }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) })).status).toBe(201);
  });

  test("the token endpoint takes form bodies only", async () => {
    const t = oauthApp();
    const res = await t.app.request("/oauth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "refresh_token" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  describe("logging", () => {
    const lines: string[] = [];
    const spies: ReturnType<typeof spyOn>[] = [];
    beforeEach(() => {
      lines.length = 0;
      for (const method of ["log", "info", "warn", "error", "debug"] as const) spies.push(spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" "))));
    });
    afterEach(() => {
      for (const spy of spies.splice(0)) spy.mockRestore();
    });

    test("codes, tokens and verifiers never reach the log, even on errors", async () => {
      const t = oauthApp();
      const { clientId, code, verifier } = await t.authorizeCode();
      const tokens = (await (await t.exchange(clientId, code, verifier)).json()) as Tokens;
      await t.exchange(clientId, code, verifier);
      await t.refresh(clientId, tokens.refresh_token);
      await t.callTool(tokens.access_token);
      await t.callTool("bogus-token");
      const log = lines.join("\n");
      for (const secret of [code, verifier, tokens.access_token, tokens.refresh_token]) expect(log).not.toContain(secret);
    });
  });
});
