import type { Config } from "../config";
import type { Db } from "../db/client";
import { enrichTracks } from "../ingest/live/enrich";
import { pollRecentlyPlayed } from "../ingest/live/poller";
import type { SpotifyAuth } from "../spotify/auth";
import type { SpotifyClient } from "../spotify/client";
import type { Job } from "./scheduler";

export type Jobs = { poll: Job; enrich: Job };

export function createJobs(db: Db, config: Config, spotifyAuth: SpotifyAuth, spotify: SpotifyClient): Jobs {
  const whenConnected = (run: () => Promise<Record<string, unknown>>) => async () =>
    spotifyAuth.status().connected ? run() : { skipped: "spotify_not_connected" };
  return {
    poll: { name: "poll", intervalMs: config.pollIntervalMs, run: whenConnected(() => pollRecentlyPlayed(db, spotify, config)) },
    enrich: { name: "enrich", intervalMs: config.enrichIntervalMs, run: whenConnected(() => enrichTracks(db, spotify, config.enrichBatchSize)) },
  };
}
