import type { Config } from "../config";
import type { Db } from "../db/client";
import { enrich, fetchAlbumArt } from "../ingest/live/enrich";
import { pollRecentlyPlayed } from "../ingest/live/poller";
import type { SpotifyAuth } from "../spotify/auth";
import type { SpotifyClient } from "../spotify/client";
import type { Job } from "./scheduler";

export type Jobs = { poll: Job; enrich: Job; art: Job };

export function createJobs(db: Db, config: Config, spotifyAuth: SpotifyAuth, spotify: SpotifyClient): Jobs {
  const whenConnected = (run: () => Promise<Record<string, unknown>>) => async () =>
    spotifyAuth.status().connected ? run() : { skipped: "spotify_not_connected" };
  return {
    poll: { name: "poll", intervalMs: config.pollIntervalMs, run: whenConnected(() => pollRecentlyPlayed(db, spotify, config)) },
    enrich: { name: "enrich", intervalMs: config.enrichIntervalMs, run: whenConnected(() => enrich(db, spotify, config.enrichBatchSize)) },
    art: { name: "art", intervalMs: config.artIntervalMs, run: () => fetchAlbumArt(db, spotify, config.enrichBatchSize) },
  };
}
