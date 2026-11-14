import type { Settings } from "../../settings/settings";
import type { Db } from "../../db/client";
import { insertPlays, type PlayInput } from "../../plays/store";
import type { SpotifyClient } from "../../spotify/client";
import { exportCoveredUntil } from "../export/import";
import { saveSpotifyTrack } from "./enrich";
import { coveredByLive } from "./reconcile";

export type PollResult = { received: number; inserted: number; skippedCoveredByExport: number; skippedCoveredByLive: number };

export async function pollRecentlyPlayed(db: Db, spotify: SpotifyClient, config: Pick<Settings, "timezone" | "historyStart">): Promise<PollResult> {
  const { items } = await spotify.recentlyPlayed();
  const cutoff = exportCoveredUntil(db) ?? -Infinity;
  const fresh = items.filter((item) => item.track?.uri?.startsWith("spotify:track:") && Date.parse(item.played_at) > cutoff);
  const unseen = fresh.filter((item) => !coveredByLive(db, item.track.uri, Date.parse(item.played_at)));
  const playRows: PlayInput[] = unseen.map((item) => {
    const ts = Date.parse(item.played_at);
    return {
      dedupeKey: `api:${ts}:${item.track.uri}`,
      ts,
      kind: "track",
      trackUri: item.track.uri,
      msPlayed: null,
      device: "unknown",
      source: "api",
      contextUri: item.context?.uri ?? null,
    };
  });
  for (const track of new Map(fresh.map((item) => [item.track.uri, item.track])).values()) saveSpotifyTrack(db, track);
  const inserted = insertPlays(db, playRows, config);
  return { received: items.length, inserted, skippedCoveredByExport: items.length - fresh.length, skippedCoveredByLive: fresh.length - unseen.length };
}
