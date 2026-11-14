import { sql } from "drizzle-orm";
import { withArtistImages } from "../analytics/common";
import type { Db } from "../db/client";

export type Artwork = { albumArtUrl: string | null; artistImageUrl: string | null };

/**
 * Adds album art (any known version of the song, else the art stored with the row) and the
 * primary artist's image, in two queries for the whole list.
 */
export function withArtwork<T extends { songKey: string; artist: string; albumArtUrl?: string | null }>(db: Db, rows: T[]): (T & Artwork)[] {
  if (rows.length === 0) return [];
  const keys = [...new Set(rows.map((r) => r.songKey))];
  const art = new Map(
    db
      .all<{ song_key: string; url: string }>(sql`
        select song_key, max(album_art_url) as url from tracks
        where album_art_url is not null and song_key in (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`, `,
        )})
        group by song_key`)
      .map((r) => [r.song_key, r.url]),
  );
  return withArtistImages(db, rows).map(({ imageUrl, ...rest }) => {
    const row = rest as unknown as T;
    return { ...row, albumArtUrl: art.get(row.songKey) ?? row.albumArtUrl ?? null, artistImageUrl: imageUrl };
  });
}
