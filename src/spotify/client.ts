import type { Config } from "../config";
import type { Db } from "../db/client";
import { getJobState, setJobState } from "../jobs/state";
import type { SpotifyAuth } from "./auth";
import { SpotifyApiError, SpotifyBlockedError, type BlockReason } from "./errors";
import type { RecentlyPlayed, SpotifyMe, SpotifyTrack } from "./types";

const apiUrl = "https://api.spotify.com/v1";
const defaultRetryAfterSeconds = 60;

export type SpotifyGate = { blockedUntil: number; reason: BlockReason; at: number };

export class SpotifyClient {
  constructor(
    private readonly db: Db,
    private readonly auth: SpotifyAuth,
    private readonly config: Pick<Config, "quotaBackoffMs">,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  gate(): SpotifyGate | null {
    const data = getJobState(this.db, "spotify")?.data as SpotifyGate | null | undefined;
    return data && data.blockedUntil > this.now() ? data : null;
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

  private async get<T>(path: string): Promise<T> {
    const gate = this.gate();
    if (gate) throw new SpotifyBlockedError(gate.reason, gate.blockedUntil);
    let res = await this.send(path, await this.auth.accessToken());
    if (res.status === 401) res = await this.send(path, await this.auth.accessToken(true));
    if (res.status === 429) throw await this.block(res);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new SpotifyApiError(res.status, body.error?.message ?? res.statusText);
    }
    return (await res.json()) as T;
  }

  private send(path: string, token: string) {
    return this.fetchFn(`${apiUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  }

  private async block(res: Response): Promise<SpotifyBlockedError> {
    const body = (await res.json().catch(() => ({}))) as { reason?: string; error?: { reason?: string } };
    const quota = (body.error?.reason ?? body.reason) === "QUOTA_EXCEEDED";
    const retryAfter = Number(res.headers.get("retry-after"));
    const retryAfterMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : defaultRetryAfterSeconds) * 1000;
    const waitMs = quota ? Math.max(this.config.quotaBackoffMs, retryAfterMs) : retryAfterMs;
    const gate: SpotifyGate = { reason: quota ? "quota_exceeded" : "rate_limited", blockedUntil: this.now() + waitMs, at: this.now() };
    setJobState(this.db, "spotify", { lastError: `${gate.reason} until ${new Date(gate.blockedUntil).toISOString()}`, data: gate });
    if (quota) console.error(`Spotify QUOTA_EXCEEDED: all Spotify calls paused until ${new Date(gate.blockedUntil).toISOString()}`);
    return new SpotifyBlockedError(gate.reason, gate.blockedUntil);
  }
}
