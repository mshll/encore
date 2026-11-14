import type { Db } from "../db/client";
import { WATCH_JOB } from "../ingest/live/watcher";
import type { Observation } from "../ingest/live/observe";
import { getJobState } from "../jobs/state";

/**
 * The playback context the player watcher last saw, playing or paused, while that sighting is recent.
 * Read from the watcher's stored state, so it costs no Spotify call.
 */
export function currentContext(db: Db, now: number, watcherIdleMs: number): string | null {
  const current = getJobState(db, WATCH_JOB)?.data?.current as Observation | null | undefined;
  if (!current || current.lastSeenAt < now - (2 * watcherIdleMs + 30_000)) return null;
  return current.contextUri;
}
