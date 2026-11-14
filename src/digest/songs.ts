import { sql } from "drizzle-orm";
import { musicWhere, songStatsSql, type SongRow } from "../analytics/common";
import type { Db } from "../db/client";
import { withArtwork } from "../library/artwork";
import type { RecapKind, Span } from "./periods";

/** How many songs a period's playlist holds at most. */
export const PLAYLIST_SIZE: Record<RecapKind, number> = { weekly: 15, monthly: 25, yearly: 50 };
/** A song needs this many listens in the period to count as one that defined it. */
export const PLAYLIST_MIN_LISTENS = 2;

export type DefiningSong = { songKey: string; uri: string; name: string; artist: string; album: string | null; albumArtUrl: string | null; listens: number; hours: number };

/**
 * The songs that defined a period: most listens (a listen is a play past 30 seconds), then most time, then the
 * song key; at least two listens. Skips are not counted against a song.
 */
export function definingSongs(db: Db, kind: RecapKind, span: Span, limit = PLAYLIST_SIZE[kind]): DefiningSong[] {
  const rows = db.all<SongRow>(
    sql`select * from (${songStatsSql(musicWhere(span))}) where listens >= ${PLAYLIST_MIN_LISTENS} order by listens desc, ms desc, song_key limit ${limit}`,
  );
  const songs = rows.map((r) => ({ songKey: r.song_key, uri: r.uri, name: r.name, artist: r.artist, album: r.album, albumArtUrl: r.album_art_url, listens: r.listens, hours: Math.round(r.ms / 36_000) / 100 }));
  return withArtwork(db, songs).map(({ artistImageUrl: _image, ...s }) => s);
}
