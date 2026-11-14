import { inArray, sql } from "drizzle-orm";
import { LISTEN } from "../analytics/common";
import type { Db } from "../db/client";
import { trackTags, tracks } from "../db/schema";
import type { TagInput } from "./schema";

export class UnknownTracksError extends Error {
  constructor(readonly uris: string[]) {
    super(`Unknown track URIs: ${uris.join(", ")}`);
  }
}

export type PendingTrack = { uri: string; name: string; artist: string; album: string | null; listens: number };

export function pendingTracks(db: Db, limit: number, offset: number): { items: PendingTrack[]; total: number } {
  const songs = sql`
    with song_plays as (
      select t.song_key, t.uri, t.name, t.artist, t.album, count(*) as plays,
        sum(${LISTEN}) as listens
      from plays p join tracks t on t.uri = p.track_uri
      where p.kind = 'track' and t.song_key not in (select song_key from track_tags)
      group by t.uri
    ),
    ranked as (
      select *, row_number() over (partition by song_key order by plays desc, uri) as rn,
        sum(listens) over (partition by song_key) as song_listens
      from song_plays
    )
    select uri, name, artist, album, song_listens as listens from ranked where rn = 1`;
  const items = db.all<PendingTrack>(sql`${songs} order by listens desc, uri limit ${limit} offset ${offset}`);
  const total = db.all<{ n: number }>(sql`select count(*) as n from (${songs})`)[0]?.n ?? 0;
  return { items, total };
}

export function upsertTags(db: Db, input: TagInput[], now = Date.now()): number {
  const uris = [...new Set(input.map((t) => t.uri))];
  const known = db.select({ uri: tracks.uri, songKey: tracks.songKey }).from(tracks).where(inArray(tracks.uri, uris)).all();
  const songKeys = new Map(known.map((k) => [k.uri, k.songKey]));
  const unknown = uris.filter((uri) => !songKeys.has(uri));
  if (unknown.length) throw new UnknownTracksError(unknown);
  const rows = input.map((t) => ({
    songKey: songKeys.get(t.uri)!,
    trackUri: t.uri,
    genres: t.genres,
    subgenre: t.subgenre ?? null,
    moods: t.moods,
    energy: t.energy,
    valence: t.valence,
    language: t.language,
    model: t.model,
    confidence: t.confidence,
    taggedAt: t.taggedAt ? Date.parse(t.taggedAt) : now,
  }));
  db.transaction((tx) => {
    for (const row of rows) {
      const { songKey, ...rest } = row;
      tx.insert(trackTags).values(row).onConflictDoUpdate({ target: trackTags.songKey, set: rest }).run();
    }
  });
  return rows.length;
}

export function tagCoverage(db: Db) {
  const row = db.all<{ songs: number; tagged: number }>(sql`
    select count(distinct t.song_key) as songs, count(distinct tt.song_key) as tagged
    from tracks t left join track_tags tt on tt.song_key = t.song_key`)[0];
  const songs = row?.songs ?? 0;
  const tagged = row?.tagged ?? 0;
  return { songs, tagged, coverage: songs ? tagged / songs : 0 };
}
