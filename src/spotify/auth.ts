import { eq, lt } from "drizzle-orm";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { oauthStates, spotifyAuth } from "../db/schema";
import type { SettingsSource } from "../settings/settings";
import { SpotifyAuthError, SpotifyNotConfiguredError, SpotifyNotConnectedError } from "./errors";

export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "ugc-image-upload",
  "user-follow-read",
  "user-library-read",
  "user-library-modify",
  "user-read-recently-played",
  "user-read-private",
  "user-top-read",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
];

const accountsUrl = "https://accounts.spotify.com";
const stateTtlMs = 10 * 60_000;
const refreshMarginMs = 60_000;

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

function randomToken(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

export class SpotifyAuth {
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: Pick<Config, "spotifyRedirectUri">,
    private readonly settings: SettingsSource,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private clientId(): string {
    const clientId = this.settings.get().spotifyClientId;
    if (!clientId) throw new SpotifyNotConfiguredError();
    return clientId;
  }

  createAuthorizeUrl(): string {
    const clientId = this.clientId();
    const state = randomToken(24);
    const codeVerifier = randomToken(64);
    const challenge = new Bun.CryptoHasher("sha256").update(codeVerifier).digest("base64url");
    this.db.delete(oauthStates).where(lt(oauthStates.expiresAt, this.now())).run();
    this.db.insert(oauthStates).values({ state, codeVerifier, expiresAt: this.now() + stateTtlMs }).run();
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: this.config.spotifyRedirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: SPOTIFY_SCOPES.join(" "),
      state,
    });
    return `${accountsUrl}/authorize?${params}`;
  }

  async completeAuthorization(code: string, state: string): Promise<void> {
    const pending = this.db.delete(oauthStates).where(eq(oauthStates.state, state)).returning().get();
    if (!pending || pending.expiresAt < this.now()) throw new SpotifyAuthError("Unknown or expired OAuth state");
    const tokens = await this.requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.spotifyRedirectUri,
      code_verifier: pending.codeVerifier,
    });
    if (!tokens.refresh_token) throw new SpotifyAuthError("Spotify returned no refresh token");
    this.save(tokens.access_token, tokens.refresh_token, tokens.expires_in, tokens.scope ?? "");
  }

  /**
   * The stored grant, if it was issued to the configured Spotify app. A grant from another app cannot be refreshed and its
   * calls count against that app, so changing the client id disconnects Spotify.
   */
  private grant() {
    const clientId = this.settings.get().spotifyClientId;
    const row = this.db.select().from(spotifyAuth).where(eq(spotifyAuth.id, 1)).get();
    return clientId && row?.clientId === clientId ? row : undefined;
  }

  status() {
    const row = this.grant();
    return row ? { connected: true, scopes: row.scope.split(" ").filter(Boolean), userId: row.spotifyUserId } : { connected: false, scopes: [], userId: null };
  }

  setUserId(userId: string) {
    this.db.update(spotifyAuth).set({ spotifyUserId: userId }).where(eq(spotifyAuth.id, 1)).run();
  }

  disconnect() {
    this.db.delete(spotifyAuth).run();
  }

  async accessToken(forceRefresh = false): Promise<string> {
    const row = this.grant();
    if (!row) throw new SpotifyNotConnectedError();
    if (!forceRefresh && row.expiresAt - refreshMarginMs > this.now()) return row.accessToken;
    this.refreshing ??= this.refresh(row.refreshToken).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(refreshToken: string): Promise<string> {
    let tokens: TokenResponse;
    try {
      tokens = await this.requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
    } catch (error) {
      if (error instanceof SpotifyAuthError && error.message.includes("invalid_grant")) this.disconnect();
      throw error;
    }
    const row = this.grant();
    this.save(tokens.access_token, tokens.refresh_token ?? refreshToken, tokens.expires_in, tokens.scope ?? row?.scope ?? "");
    return tokens.access_token;
  }

  private save(accessToken: string, refreshToken: string, expiresIn: number, scope: string) {
    const now = this.now();
    const clientId = this.clientId();
    const values = { id: 1, accessToken, refreshToken, expiresAt: now + expiresIn * 1000, scope, clientId, updatedAt: now };
    this.db
      .insert(spotifyAuth)
      .values(values)
      .onConflictDoUpdate({ target: spotifyAuth.id, set: { accessToken, refreshToken, expiresAt: values.expiresAt, scope, clientId, updatedAt: now } })
      .run();
  }

  private async requestToken(params: Record<string, string>): Promise<TokenResponse> {
    const res = await this.fetchFn(`${accountsUrl}/api/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: this.clientId() }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string };
      throw new SpotifyAuthError(`Token request failed (${res.status}): ${body.error ?? "unknown"} ${body.error_description ?? ""}`.trim());
    }
    return (await res.json()) as TokenResponse;
  }
}
