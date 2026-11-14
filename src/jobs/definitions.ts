import type { Config } from "../config";
import type { Db } from "../db/client";
import { enrich, fetchAlbumArt } from "../ingest/live/enrich";
import { pollRecentlyPlayed } from "../ingest/live/poller";
import { WATCH_JOB } from "../ingest/live/watcher";
import { appOwnedPlaylistIds } from "../library/owned";
import { refreshProposals } from "../library/rules";
import { syncDue, syncStep, type SyncCursor } from "../library/sync";
import { markRemovedPlaylists, runLiving } from "../living/refresh";
import { runRadar } from "../radar/radar";
import type { Services } from "../services";
import type { SettingsSource } from "../settings/settings";
import type { SpotifyAuth } from "../spotify/auth";
import type { SpotifyClient } from "../spotify/client";
import type { Job } from "./scheduler";
import { getJobState } from "./state";

export type Jobs = { poll: Job; enrich: Job; art: Job; watch: Job; radar: Job; library: Job; living: Job };

export const LIBRARY_JOB = "library";
export const LIVING_JOB = "living";
const LIVING_TICK_MS = 10 * 60_000;

export function libraryCursor(db: Db): SyncCursor {
  return (getJobState(db, LIBRARY_JOB)?.data?.cursor as SyncCursor | undefined) ?? { phase: "idle", completedAt: null };
}

export function createJobs(db: Db, settings: SettingsSource, spotifyAuth: SpotifyAuth, spotify: SpotifyClient, services: Services, now: () => number = Date.now): Jobs {
  const whenConnected = (run: () => Promise<Record<string, unknown>>) => async () =>
    spotifyAuth.status().connected ? run() : { skipped: "spotify_not_connected" };
  const current = () => settings.get();
  return {
    poll: { name: "poll", intervalMs: () => current().pollIntervalMs, run: whenConnected(() => pollRecentlyPlayed(db, spotify, current())) },
    enrich: { name: "enrich", intervalMs: () => current().enrichIntervalMs, run: whenConnected(() => enrich(db, spotify, current().enrichBatchSize)) },
    art: { name: "art", intervalMs: () => current().artIntervalMs, run: () => fetchAlbumArt(db, spotify, current().enrichBatchSize) },
    watch: { name: WATCH_JOB, intervalMs: () => current().watcherIdleMs, run: () => services.watcher.tick(), nextDelayMs: () => services.watcher.nextDelayMs() },
    radar: { name: "radar", intervalMs: () => current().radarIntervalMs, run: whenConnected(() => runRadar(db, spotify, current(), now())) },
    library: {
      name: LIBRARY_JOB,
      intervalMs: () => current().libraryPageMs,
      run: async () => {
        const cursor = libraryCursor(db);
        if (!spotifyAuth.status().connected) return { cursor, skipped: "spotify_not_connected" };
        if (!syncDue(cursor, now(), current().librarySyncMs)) return { cursor };
        const step = await syncStep(
          {
            db,
            spotify,
            spotifyAuth,
            appPlaylistIds: () => appOwnedPlaylistIds(db),
            appPlaylistsListed: (listed, startedAt) => markRemovedPlaylists(db, listed, startedAt, now()),
          },
          cursor,
          now(),
        );
        return { cursor: step.cursor, calls: step.calls, ...(step.passCompleted ? { proposals: refreshProposals(db, now(), current()) } : {}) };
      },
      nextDelayMs: () => {
        const { libraryPageMs, librarySyncMs } = current();
        const cursor = libraryCursor(db);
        if (cursor.phase !== "idle" || cursor.completedAt === null) return libraryPageMs;
        return Math.max(libraryPageMs, cursor.completedAt + librarySyncMs - now());
      },
    },
    living: { name: LIVING_JOB, intervalMs: () => LIVING_TICK_MS, run: whenConnected(() => runLiving({ db, spotify, settings, now })) },
  };
}

export function enabledJobs(jobs: Jobs, config: Pick<Config, "disabledJobs">): Job[] {
  return Object.values(jobs).filter((job) => !config.disabledJobs.includes(job.name));
}
