import type { Config } from "../config";
import type { Db } from "../db/client";
import { getJobState, setJobState } from "../jobs/state";
import type { SpotifyAuth } from "./auth";
import { SpotifyPacer } from "./pacer";
import { SpotifyApiError, SpotifyBlockedError, type BlockReason } from "./errors";
import type { RecentlyPlayed, SpotifyArtist, SpotifyMe, SpotifyPlaylist, SpotifySearch, SpotifyTrack } from "./types";

const apiUrl = "https://api.spotify.com/v1";
const oembedUrl = "https://open.spotify.com/oembed";
const defaultRetryAfterSeconds = 60;
const CALLS_STATE = "spotify_calls";
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type SpotifyGate = { blockedUntil: number; reason: BlockReason; at: number; clientId?: string };

export class SpotifyClient {
  constructor(
    private readonly db: Db,
    private readonly auth: SpotifyAuth,
    private readonly config: Pick<Config, "quotaBackoffMs" | "spotifyIntervalMs" | "spotifyClientId">,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    readonly pacer: SpotifyPacer = new SpotifyPacer(config.spotifyIntervalMs, now),
  ) {}

  gate(): SpotifyGate | null {
    const data = getJobState(this.db, "spotify")?.data as SpotifyGate | null | undefined;
    return data && data.blockedUntil > this.now() && data.clientId === this.config.spotifyClientId ? data : null;
  }

  me() {
    return this.get<SpotifyMe>("/me");
  }

  recentlyPlayed() {
    return this.get<RecentlyPlayed>("/me/player/recently-played?limit=50");
  }

  track(id: string) {
    return this.get<SpotifyTrack>(`/tracks/${encodeURIComponent(id)}`);
  }

  artist(id: string) {
    return this.get<SpotifyArtist>(`/artists/${encodeURIComponent(id)}`);
  }

  async trackThumbnail(id: string): Promise<string | null> {
    const url = `${oembedUrl}?url=${encodeURIComponent(`spotify:track:${id}`)}`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw res.status === 429 ? new Error("Spotify oEmbed is rate limited") : new SpotifyApiError(res.status, res.statusText);
    return ((await res.json()) as { thumbnail_url?: string }).thumbnail_url ?? null;
  }

  searchTracks(query: string, limit: number) {
    return this.get<SpotifySearch>(`/search?${new URLSearchParams({ q: query, type: "track", limit: String(limit) })}`);
  }

  createPlaylist(input: { name: string; description: string; public: boolean }) {
    return this.request<SpotifyPlaylist>("POST", "/me/playlists", input);
  }

  updatePlaylistDetails(id: string, input: { name: string; description: string }) {
    return this.request<void>("PUT", `/playlists/${encodeURIComponent(id)}`, input);
  }

  replacePlaylistItems(id: string, uris: string[]) {
    return this.request<{ snapshot_id: string }>("PUT", `/playlists/${encodeURIComponent(id)}/items`, { uris });
  }

  libraryContains(uris: string[]) {
    return this.get<boolean[]>(`/me/library/contains?${new URLSearchParams({ uris: uris.join(",") })}`);
  }

  request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    return this.pacer.run(() => this.call<T>(async (refresh) => this.send(path, await this.auth.accessToken(refresh), method, body), true));
  }

  /** Web API requests sent on the current UTC day. Spotify does not publish its quota, so this is the only measure of what a lockout cost. */
  callsToday(): number {
    const data = getJobState(this.db, CALLS_STATE)?.data as { day: string; calls: number } | null | undefined;
    return data?.day === utcDay(this.now()) ? data.calls : 0;
  }

  private countCall() {
    setJobState(this.db, CALLS_STATE, { data: { day: utcDay(this.now()), calls: this.callsToday() + 1 } });
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async call<T>(send: (refresh: boolean) => Promise<Response>, retryUnauthorized = false): Promise<T> {
    const gate = this.gate();
    if (gate) throw new SpotifyBlockedError(gate.reason, gate.blockedUntil);
    this.countCall();
    let res = await send(false);
    if (res.status === 401 && retryUnauthorized) {
      this.countCall();
      res = await send(true);
    }
    if (res.status === 429) throw await this.block(res);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; reason?: string } };
      throw new SpotifyApiError(res.status, body.error?.message ?? res.statusText, body.error?.reason);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  private send(path: string, token: string, method: string, body: unknown) {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body === undefined) return this.fetchFn(`${apiUrl}${path}`, method === "GET" ? { headers } : { method, headers });
    headers["content-type"] = "application/json";
    return this.fetchFn(`${apiUrl}${path}`, { method, headers, body: JSON.stringify(body) });
  }

  private async block(res: Response): Promise<SpotifyBlockedError> {
    const body = (await res.json().catch(() => ({}))) as { reason?: string; error?: { reason?: string } };
    const quota = (body.error?.reason ?? body.reason) === "QUOTA_EXCEEDED";
    const retryAfter = Number(res.headers.get("retry-after"));
    const retryAfterMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : defaultRetryAfterSeconds) * 1000;
    const waitMs = quota ? Math.max(this.config.quotaBackoffMs, retryAfterMs) : retryAfterMs;
    const gate: SpotifyGate = { reason: quota ? "quota_exceeded" : "rate_limited", blockedUntil: this.now() + waitMs, at: this.now(), clientId: this.config.spotifyClientId };
    setJobState(this.db, "spotify", { lastError: `${gate.reason} until ${new Date(gate.blockedUntil).toISOString()}`, data: gate });
    if (quota) console.error(`Spotify QUOTA_EXCEEDED after ${this.callsToday()} calls today (UTC): all Spotify calls paused until ${new Date(gate.blockedUntil).toISOString()}`);
    return new SpotifyBlockedError(gate.reason, gate.blockedUntil);
  }
}
