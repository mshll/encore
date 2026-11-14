import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { containsPattern, MUSIC, musicWhere, songStatsSql, songWithStats, STATS, stats, type SongRow, type StatsRow, withArtistImages } from "./common";

export function search(db: Db, { q, limit }: { q: string; limit: number }) {
  const like = containsPattern(q);
  const artists = db.all<StatsRow & { artist: string }>(sql`
    select t.artist, ${STATS} from ${MUSIC} where ${musicWhere({}, sql`t.artist like ${like} escape '\\'`)}
    group by t.artist order by listens desc, t.artist limit ${limit}`);
  const songs = db.all<SongRow>(sql`
    select * from (${songStatsSql(musicWhere({}, sql`t.name like ${like} escape '\\'`))})
    order by listens desc, song_key limit ${limit}`);
  const albums = db.all<StatsRow & { artist: string; album: string; album_art_url: string | null }>(sql`
    select t.artist, t.album, max(t.album_art_url) as album_art_url, ${STATS} from ${MUSIC}
    where ${musicWhere({}, sql`t.album like ${like} escape '\\'`)}
    group by t.artist, t.album order by listens desc, t.artist, t.album limit ${limit}`);
  return {
    artists: withArtistImages(
      db,
      artists.map((a) => ({ artist: a.artist, ...stats(a) })),
    ),
    songs: songs.map(songWithStats),
    albums: albums.map((a) => ({ album: a.album, artist: a.artist, albumArtUrl: a.album_art_url, ...stats(a) })),
  };
}
