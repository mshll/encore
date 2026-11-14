import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { plays, tracks } from "../../db/schema";
import { upsertTracks } from "../../plays/store";
import type { SpotifyClient } from "../../spotify/client";
import { SpotifyApiError } from "../../spotify/errors";
import { trackFromSpotify } from "./track";

export const MAX_ENRICH_ATTEMPTS = 3;

export type EnrichResult = { attempted: number; enriched: number; failed: number };

export function enrichmentProgress(db: Db) {
  const row = db
    .select({
      total: sql<number>`count(*)`,
      enriched: sql<number>`count(${tracks.enrichedAt})`,
      failed: sql<number>`sum(${tracks.enrichedAt} is null and ${tracks.enrichAttempts} >= ${MAX_ENRICH_ATTEMPTS})`,
    })
    .from(tracks)
    .get();
  return { total: row?.total ?? 0, enriched: row?.enriched ?? 0, failed: row?.failed ?? 0 };
}

export async function enrichTracks(db: Db, spotify: SpotifyClient, batchSize: number): Promise<EnrichResult> {
  const pending = db
    .select({ uri: tracks.uri })
    .from(tracks)
    .leftJoin(plays, eq(plays.trackUri, tracks.uri))
    .where(and(isNull(tracks.enrichedAt), lt(tracks.enrichAttempts, MAX_ENRICH_ATTEMPTS)))
    .groupBy(tracks.uri)
    .orderBy(tracks.enrichAttempts, sql`count(${plays.id}) desc`)
    .limit(batchSize)
    .all();
  const result: EnrichResult = { attempted: 0, enriched: 0, failed: 0 };
  for (const { uri } of pending) {
    result.attempted++;
    try {
      const track = await spotify.track(uri.split(":")[2]!);
      upsertTracks(db, [{ ...trackFromSpotify(track), uri }]);
      result.enriched++;
    } catch (error) {
      if (!(error instanceof SpotifyApiError)) throw error;
      db.update(tracks).set({ enrichAttempts: sql`${tracks.enrichAttempts} + 1` }).where(eq(tracks.uri, uri)).run();
      result.failed++;
    }
  }
  return result;
}
