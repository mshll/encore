import type { Db } from "../../db/client";
import { getJobState } from "../../jobs/state";
import type { PlayerApi } from "../../player/api";
import type { SettingsSource } from "../../settings/settings";
import { SpotifyBlockedError, SpotifyNotConnectedError } from "../../spotify/errors";
import type { PlaybackState, SpotifyTrack } from "../../spotify/types";
import { saveSpotifyTrack } from "./enrich";
import { step, type FinishedPlay, type Observation, type Snapshot } from "./observe";
import { recordLivePlays, type LiveResult } from "./reconcile";

export type WatchEvent = { type: "started"; observation: Observation } | { type: "finished"; play: FinishedPlay };

export type NowPlaying = {
  playing: boolean;
  track: { uri: string; name: string; artist: string; album: string; albumArtUrl: string | null; durationMs: number } | null;
  progressMs: number | null;
  shuffle: boolean | null;
  device: { name: string; type: string } | null;
  contextUri: string | null;
  fetchedAt: string | null;
};

export const WATCH_JOB = "watch";

function snapshotOf(state: PlaybackState | null): Snapshot | null {
  if (!state || state.currently_playing_type !== "track" || !state.item?.uri?.startsWith("spotify:track:")) return null;
  return {
    trackUri: state.item.uri,
    durationMs: state.item.duration_ms,
    progressMs: state.progress_ms ?? 0,
    isPlaying: state.is_playing,
    shuffle: state.shuffle_state,
    deviceName: state.device.name,
    deviceType: state.device.type,
    contextUri: state.context?.uri ?? null,
  };
}

/** After a command that changes the song, Spotify takes a moment to report it: for this long, now playing is at most this old. */
const SETTLE_MS = 4_000;
const SETTLE_MAX_AGE_MS = 1_000;

export class Watcher {
  private current: Observation | null;
  private latest: { state: PlaybackState | null; at: number } | null = null;
  private blockedUntil = 0;
  private failures = 0;
  private inFlight: Promise<Record<string, unknown>> | null = null;
  private settleUntil = 0;
  private readonly listeners: ((event: WatchEvent) => void)[] = [];

  constructor(
    private readonly db: Db,
    private readonly player: PlayerApi,
    private readonly settings: SettingsSource,
    private readonly now: () => number = Date.now,
  ) {
    this.current = (getJobState(db, WATCH_JOB)?.data?.current as Observation | undefined) ?? null;
  }

  subscribe(listener: (event: WatchEvent) => void) {
    this.listeners.push(listener);
  }

  observation(): Observation | null {
    return this.current;
  }

  tick(): Promise<Record<string, unknown>> {
    this.inFlight ??= this.poll().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  nextDelayMs(): number {
    const now = this.now();
    const { watcherActiveMs, watcherIdleMs, watcherBackoffMaxMs } = this.settings.get();
    if (this.failures > 0) {
      const backoff = Math.min(watcherBackoffMaxMs, watcherActiveMs * 2 ** this.failures);
      return Math.max(backoff, this.blockedUntil - now);
    }
    return this.current?.wasPlaying ? watcherActiveMs : watcherIdleMs;
  }

  /**
   * A playback command the owner sent has succeeded. What it changed for certain (playing, shuffle) shows at once;
   * anything else (the song after play or next) is read from Spotify again while it settles.
   */
  applied(change: { playing?: boolean; shuffle?: boolean } = {}) {
    const now = this.now();
    const state = this.latest?.state;
    if (state) {
      const progress = state.progress_ms !== null && state.is_playing ? state.progress_ms + (now - this.latest!.at) : state.progress_ms;
      this.latest = {
        at: now,
        state: { ...state, progress_ms: progress, ...(change.playing === undefined ? {} : { is_playing: change.playing }), ...(change.shuffle === undefined ? {} : { shuffle_state: change.shuffle }) },
      };
    }
    if (change.playing !== false && change.shuffle === undefined) this.settleUntil = now + SETTLE_MS;
  }

  async nowPlaying(maxAgeMs: number): Promise<NowPlaying> {
    if (this.now() < this.settleUntil) maxAgeMs = Math.min(maxAgeMs, SETTLE_MAX_AGE_MS);
    if ((!this.latest || this.now() - this.latest.at > maxAgeMs) && this.now() >= this.blockedUntil) await this.tick().catch((error: unknown) => console.error(`[watch] refresh failed: ${error instanceof Error ? error.message : error}`));
    const state = this.latest?.state ?? null;
    const item = state?.currently_playing_type === "track" ? state.item : null;
    const progress = state?.progress_ms ?? null;
    const extrapolated = progress !== null && state?.is_playing && item ? Math.min(item.duration_ms, progress + (this.now() - this.latest!.at)) : progress;
    return {
      playing: Boolean(state?.is_playing && item),
      track: item ? trackSummary(item) : null,
      progressMs: item ? extrapolated : null,
      shuffle: state?.shuffle_state ?? null,
      device: state ? { name: state.device.name, type: state.device.type } : null,
      contextUri: state?.context?.uri ?? null,
      fetchedAt: this.latest ? new Date(this.latest.at).toISOString() : null,
    };
  }

  private async poll(): Promise<Record<string, unknown>> {
    let state: PlaybackState | null;
    try {
      state = await this.player.state();
    } catch (error) {
      if (error instanceof SpotifyNotConnectedError) return { current: this.current, skipped: "spotify_not_connected" };
      this.failures++;
      if (error instanceof SpotifyBlockedError) {
        this.blockedUntil = error.blockedUntil;
        return { current: this.current, skipped: "spotify_paused", until: new Date(error.blockedUntil).toISOString() };
      }
      throw error;
    }
    this.failures = 0;
    const now = this.now();
    this.latest = { state, at: now };
    const result = this.advance(state, now);
    return { current: this.current, ...result };
  }

  private advance(state: PlaybackState | null, now: number): LiveResult & { playing: boolean } {
    const snap = snapshotOf(state);
    const settings = this.settings.get();
    const { watcherIdleMs } = settings;
    const staleMs = 2 * watcherIdleMs + 30_000;
    const { current, finished } = step(this.current, snap, now, staleMs);
    const started = current && current.startedAt !== this.current?.startedAt ? current : null;
    if (started && state?.item) saveSpotifyTrack(this.db, state.item);
    const result = finished.length ? recordLivePlays(this.db, finished, settings) : { inserted: 0, replacedApi: 0, coveredByExport: 0 };
    this.current = current;
    for (const play of finished) this.emit({ type: "finished", play });
    if (started) this.emit({ type: "started", observation: started });
    return { ...result, playing: Boolean(snap?.isPlaying) };
  }

  private emit(event: WatchEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(`[watch] listener failed: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

export function trackSummary(track: SpotifyTrack) {
  return {
    uri: track.uri,
    name: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    album: track.album.name,
    albumArtUrl: track.album.images?.[0]?.url ?? null,
    durationMs: track.duration_ms,
  };
}
