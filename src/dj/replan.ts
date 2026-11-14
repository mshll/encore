import { sql } from "drizzle-orm";
import { HOUR_BUCKET, dayTypeSql, LISTEN, MUSIC, SKIP_KNOWN, SKIPPED } from "../analytics/common";
import type { Db } from "../db/client";
import { dayTypeOf } from "../library/catalog";
import { localTime, type Locale } from "../plays/localTime";

export type ReplanInput = {
  finished: string[];
  skipped: string[];
  current: string | null;
  upcoming: string[];
  exclude: string[];
  now: number;
};

export type Replanner = (input: ReplanInput) => Promise<string[]>;

type SongInfo = { uri: string; songKey: string; genres: string[]; moods: string[]; energy: number | null; valence: number | null };
type Profile = { tags: Map<string, number>; energy: number | null; valence: number | null; size: number };

const TOP_UP_POOL = 300;
const MIN_TOP_UP_LISTENS = 5;
const MIN_CONTEXT_PLAYS = 3;

function songInfo(db: Db, uris: string[]): Map<string, SongInfo> {
  if (uris.length === 0) return new Map();
  const rows = db.all<{ uri: string; song_key: string; genres: string | null; moods: string | null; energy: number | null; valence: number | null }>(sql`
    select t.uri, t.song_key, tt.genres, tt.moods, tt.energy, tt.valence
    from tracks t left join track_tags tt on tt.song_key = t.song_key
    where t.uri in (${sql.join(
      uris.map((u) => sql`${u}`),
      sql`, `,
    )})`);
  return new Map(
    rows.map((r) => [
      r.uri,
      { uri: r.uri, songKey: r.song_key, genres: r.genres ? JSON.parse(r.genres) : [], moods: r.moods ? JSON.parse(r.moods) : [], energy: r.energy, valence: r.valence },
    ]),
  );
}

function profile(songs: SongInfo[]): Profile {
  const tags = new Map<string, number>();
  const energies: number[] = [];
  const valences: number[] = [];
  for (const s of songs) {
    for (const tag of [...s.genres, ...s.moods]) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    if (s.energy !== null) energies.push(s.energy);
    if (s.valence !== null) valences.push(s.valence);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return { tags, energy: mean(energies), valence: mean(valences), size: songs.length };
}

export function similarity(song: SongInfo, p: Profile): number {
  if (p.size === 0) return 0;
  const tags = [...song.genres, ...song.moods];
  const tagScore = tags.length ? tags.reduce((sum, t) => sum + (p.tags.get(t) ?? 0) / p.size, 0) / tags.length : 0;
  const closeness = (a: number | null, b: number | null) => (a === null || b === null ? 0 : 1 - Math.abs(a - b) / 4);
  return (tagScore + closeness(song.energy, p.energy) * 0.5 + closeness(song.valence, p.valence) * 0.5) / 2;
}

function contextFit(db: Db, songKeys: string[], hour: number, weekday: number, weekendDays: readonly number[]): Map<string, number> {
  if (songKeys.length === 0) return new Map();
  const bucket = hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const dayType = dayTypeOf(weekday, weekendDays);
  const rows = db.all<{ song_key: string; dim: string; plays: number; skips: number }>(sql`
    select t.song_key, 'hour' as dim, count(*) as plays, sum(${SKIPPED}) as skips
    from ${MUSIC}
    where p.kind = 'track' and ${SKIP_KNOWN} and ${HOUR_BUCKET} = ${bucket} and t.song_key in (${sql.join(
      songKeys.map((k) => sql`${k}`),
      sql`, `,
    )})
    group by t.song_key
    union all
    select t.song_key, 'day' as dim, count(*) as plays, sum(${SKIPPED}) as skips
    from ${MUSIC}
    where p.kind = 'track' and ${SKIP_KNOWN} and ${dayTypeSql(weekendDays)} = ${dayType} and t.song_key in (${sql.join(
      songKeys.map((k) => sql`${k}`),
      sql`, `,
    )})
    group by t.song_key`);
  const fits = new Map<string, number[]>();
  for (const r of rows) {
    if (r.plays < MIN_CONTEXT_PLAYS) continue;
    fits.set(r.song_key, [...(fits.get(r.song_key) ?? []), 1 - r.skips / r.plays]);
  }
  return new Map([...fits].map(([key, xs]) => [key, xs.reduce((a, b) => a + b, 0) / xs.length]));
}

function topUpCandidates(db: Db, exclude: Set<string>): string[] {
  return db
    .all<{ uri: string }>(sql`
      select uri from (
        select t.uri, t.song_key, row_number() over (partition by t.song_key order by count(*) desc) as rn,
          sum(sum(${LISTEN})) over (partition by t.song_key) as listens
        from plays p join tracks t on t.uri = p.track_uri join track_tags tt on tt.song_key = t.song_key
        where p.kind = 'track' group by t.uri
      ) where rn = 1 and listens >= ${MIN_TOP_UP_LISTENS} order by listens desc limit ${TOP_UP_POOL}`)
    .map((r) => r.uri)
    .filter((uri) => !exclude.has(uri));
}

export function createDefaultReplanner(db: Db, locale: () => Locale): Replanner {
  return async (input) => {
    const { timezone, weekendDays } = locale();
    const exclude = new Set([...input.exclude, ...input.upcoming]);
    const known = songInfo(db, [...input.finished, ...input.skipped]);
    const liked = profile(input.finished.flatMap((u) => known.get(u) ?? []));
    const disliked = profile(input.skipped.flatMap((u) => known.get(u) ?? []));
    const pool = [...input.upcoming, ...(liked.size > 0 ? topUpCandidates(db, exclude) : [])];
    const info = songInfo(db, pool);
    const { hour, weekday } = localTime(input.now, timezone);
    const fit = contextFit(db, [...new Set([...info.values()].map((s) => s.songKey))], hour, weekday, weekendDays);
    const skippedKeys = new Set(input.skipped.flatMap((u) => known.get(u)?.songKey ?? []));
    const scored = pool
      .map((uri, order) => {
        const song = info.get(uri);
        if (!song) return { uri, order, score: 0.5, keep: order < input.upcoming.length };
        const keep = !skippedKeys.has(song.songKey);
        const score = (fit.get(song.songKey) ?? 0.5) + similarity(song, liked) - similarity(song, disliked);
        return { uri, order, score, keep };
      })
      .filter((s) => s.keep);
    const upcoming = scored.filter((s) => s.order < input.upcoming.length);
    const extra = scored
      .filter((s) => s.order >= input.upcoming.length && s.score > 0.5 + Number.EPSILON)
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, Math.max(0, input.upcoming.length - upcoming.length));
    return [...upcoming, ...extra].sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.uri);
  };
}
