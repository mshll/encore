import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { insertPlays, upsertTracks, type PlayInput } from "../../plays/store";
import type { SpotifyClient } from "../../spotify/client";
import { exportCoveredUntil } from "../export/import";
import { trackFromSpotify } from "./track";

export type PollResult = { received: number; inserted: number; skippedCoveredByExport: number };

export async function pollRecentlyPlayed(db: Db, spotify: SpotifyClient, config: Pick<Config, "timezone">): Promise<PollResult> {
  const { items } = await spotify.recentlyPlayed();
  const cutoff = exportCoveredUntil(db) ?? -Infinity;
  const fresh = items.filter((item) => item.track?.uri?.startsWith("spotify:track:") && Date.parse(item.played_at) > cutoff);
  const playRows: PlayInput[] = fresh.map((item) => {
    const ts = Date.parse(item.played_at);
    return {
      dedupeKey: `api:${ts}:${item.track.uri}`,
      ts,
      kind: "track",
      trackUri: item.track.uri,
      msPlayed: null,
      device: "unknown",
      source: "api",
    };
  });
  upsertTracks(db, fresh.map((item) => trackFromSpotify(item.track)));
  const inserted = insertPlays(db, playRows, config.timezone);
  return { received: items.length, inserted, skippedCoveredByExport: items.length - fresh.length };
}
