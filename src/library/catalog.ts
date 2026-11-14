import { sql } from "drizzle-orm";
import { HOUR_BUCKET, dayTypeSql, MUSIC, musicWhere, songStatsSql, type SongRow } from "../analytics/common";
import { momentSplit, type MomentClass } from "../analytics/skips";
import type { Db } from "../db/client";

export type HourBucket = "night" | "morning" | "afternoon" | "evening";
export type DayType = "weekday" | "weekend";
export type ContextCounts = { plays: number; skips: number };

export type CatalogSong = {
  songKey: string;
  uri: string;
  name: string;
  artist: string;
  album: string | null;
  plays: number;
  listens: number;
  hours: number;
  skipRate: number | null;
  firstPlayed: number;
  lastPlayed: number;
  tags: { genres: string[]; subgenre: string | null; moods: string[]; energy: number; valence: number; language: string } | null;
  class: MomentClass | null;
  hourBucket: Partial<Record<HourBucket, ContextCounts>>;
  dayType: Partial<Record<DayType, ContextCounts>>;
};

export type Catalog = { version: string; songs: Map<string, CatalogSong> };

let cached: { db: Db; catalog: Catalog } | null = null;

function dataVersion(db: Db): string {
  const row = db.all<{ plays: number; tags: number; tagged: number }>(
    sql`select (select max(id) from plays) as plays, (select count(*) from track_tags) as tags, (select max(tagged_at) from track_tags) as tagged`,
  )[0]!;
  return `${row.plays}:${row.tags}:${row.tagged}`;
}

export function loadCatalog(db: Db, weekendDays: readonly number[]): Catalog {
  const version = `${dataVersion(db)}:${weekendDays.join(",")}`;
  if (cached?.db === db && cached.catalog.version === version) return cached.catalog;
  const songs = new Map<string, CatalogSong>();
  for (const r of db.all<SongRow>(songStatsSql(musicWhere({})))) {
    songs.set(r.song_key, {
      songKey: r.song_key,
      uri: r.uri,
      name: r.name,
      artist: r.artist,
      album: r.album,
      plays: r.plays,
      listens: r.listens,
      hours: Math.round(r.ms / 36_000) / 100,
      skipRate: r.skip_known ? Math.round((r.skips / r.skip_known) * 100) / 100 : null,
      firstPlayed: r.first_ts!,
      lastPlayed: r.last_ts!,
      tags: null,
      class: null,
      hourBucket: {},
      dayType: {},
    });
  }
  const tags = db.all<{ song_key: string; genres: string; subgenre: string | null; moods: string; energy: number; valence: number; language: string }>(
    sql`select song_key, genres, subgenre, moods, energy, valence, language from track_tags`,
  );
  for (const t of tags) {
    const song = songs.get(t.song_key);
    if (song) song.tags = { genres: JSON.parse(t.genres), subgenre: t.subgenre, moods: JSON.parse(t.moods), energy: t.energy, valence: t.valence, language: t.language };
  }
  for (const s of momentSplit(db, { range: {}, minPlays: 8, minContextPlays: 5, limit: 1_000_000, weekendDays }).songs) {
    const song = songs.get(s.songKey);
    if (song) song.class = s.class;
  }
  const contexts = db.all<{ song_key: string; dim: "hourBucket" | "dayType"; value: string; plays: number; skips: number }>(sql`
    select t.song_key, 'hourBucket' as dim, ${HOUR_BUCKET} as value, count(*) as plays, sum(p.skipped = 1) as skips
    from ${MUSIC} where ${musicWhere({})} and p.skipped is not null group by t.song_key, value
    union all
    select t.song_key, 'dayType' as dim, ${dayTypeSql(weekendDays)} as value, count(*) as plays, sum(p.skipped = 1) as skips
    from ${MUSIC} where ${musicWhere({})} and p.skipped is not null group by t.song_key, value`);
  for (const c of contexts) {
    const song = songs.get(c.song_key);
    if (!song) continue;
    (song[c.dim] as Record<string, ContextCounts>)[c.value] = { plays: c.plays, skips: c.skips };
  }
  const catalog = { version, songs };
  cached = { db, catalog };
  return catalog;
}

export function hourBucketOf(hour: number): HourBucket {
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export const dayTypeOf = (weekday: number, weekendDays: readonly number[]): DayType => (weekendDays.includes(weekday) ? "weekend" : "weekday");
