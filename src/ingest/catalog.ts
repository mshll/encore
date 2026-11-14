import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { artists, trackArtists, tracks } from "../db/schema";

export const catalogBody = z.object({
  artists: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1), imageUrl: z.url().nullable(), fetchedAt: z.number().int().nullable() }))
    .max(1000)
    .default([]),
  tracks: z
    .array(
      z.object({
        uri: z.string().startsWith("spotify:track:"),
        durationMs: z.number().int().nullable(),
        releaseDate: z.string().nullable(),
        albumArtUrl: z.url().nullable(),
        enrichedAt: z.number().int().nullable(),
        artistIds: z.array(z.string().min(1)).max(50),
      }),
    )
    .max(1000)
    .default([]),
});

export type CatalogInput = z.infer<typeof catalogBody>;

/**
 * Fills in track and artist details fetched by another instance, so they are not fetched from Spotify again.
 * Values already present win. Unknown tracks are skipped; artist links are set only for tracks not yet
 * enriched here, and only when every linked artist is known.
 */
export function seedCatalog(db: Db, input: CatalogInput) {
  return db.transaction((tx) => {
    for (const a of input.artists) {
      tx.insert(artists)
        .values({ id: a.id, name: a.name, imageUrl: a.imageUrl, fetchedAt: a.fetchedAt })
        .onConflictDoUpdate({ target: artists.id, set: { imageUrl: sql`coalesce(${artists.imageUrl}, excluded.image_url)`, fetchedAt: sql`coalesce(${artists.fetchedAt}, excluded.fetched_at)` } })
        .run();
    }
    let updated = 0;
    for (const t of input.tracks) {
      const stored = tx.select({ enrichedAt: tracks.enrichedAt }).from(tracks).where(eq(tracks.uri, t.uri)).get();
      if (!stored) continue;
      updated++;
      const known = t.artistIds.length ? tx.select({ id: artists.id }).from(artists).where(inArray(artists.id, t.artistIds)).all().length : 0;
      const linkable = stored.enrichedAt === null && t.artistIds.length > 0 && known === new Set(t.artistIds).size;
      if (linkable) {
        tx.delete(trackArtists).where(eq(trackArtists.trackUri, t.uri)).run();
        tx.insert(trackArtists).values(t.artistIds.map((artistId, position) => ({ trackUri: t.uri, artistId, position }))).run();
      }
      tx.update(tracks)
        .set({
          durationMs: sql`coalesce(${tracks.durationMs}, ${t.durationMs})`,
          releaseDate: sql`coalesce(${tracks.releaseDate}, ${t.releaseDate})`,
          albumArtUrl: sql`coalesce(${tracks.albumArtUrl}, ${t.albumArtUrl})`,
          ...(linkable || t.artistIds.length === 0 ? { enrichedAt: sql`coalesce(${tracks.enrichedAt}, ${t.enrichedAt})` } : {}),
        })
        .where(eq(tracks.uri, t.uri))
        .run();
    }
    return { artists: input.artists.length, tracks: updated, unknownTracks: input.tracks.length - updated };
  });
}
