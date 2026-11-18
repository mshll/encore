import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hours, LISTEN, MS, MUSIC, musicWhere, rate, type Range, songStatsSql, songWithStats, type SongRow, withArtistImages } from "./common";

const HOUR_MS = 3_600_000;

/** When a song or an artist was first played, all time: the day its first music play fell on. */
const FIRST_SONG = sql`select t.song_key as song_key, min(p.day) as first_day from ${MUSIC} where ${musicWhere({})} group by t.song_key`;
const FIRST_ARTIST = sql`select t.artist as artist, min(p.day) as first_day from ${MUSIC} where ${musicWhere({})} group by t.artist`;

const firstDay = (db: Db): string | null => db.all<{ day: string | null }>(sql`select min(p.day) as day from plays p where ${musicWhere({})}`)[0]?.day ?? null;

const monthOf = (day: string) => day.slice(0, 7);

function lastOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * New artists and songs per month (first played that month, all time) and the share of the month's hours spent on songs
 * first heard that month. The month the history starts in is left out: everything in it is new.
 */
export function discovery(db: Db, { range }: { range: Range }) {
  const start = firstDay(db);
  if (!start) return { historyStart: null, months: [], totals: { hours: 0, newHours: 0, newShare: null, newArtists: 0, newSongs: 0 } };
  const listened = db.all<{ month: string; ms: number; new_ms: number }>(sql`
    with first_song as (${FIRST_SONG})
    select substr(p.day, 1, 7) as month, sum(${MS}) as ms,
      sum(case when substr(fs.first_day, 1, 7) = substr(p.day, 1, 7) then ${MS} else 0 end) as new_ms
    from ${MUSIC} join first_song fs on fs.song_key = t.song_key
    where ${musicWhere(range)} and substr(p.day, 1, 7) > ${monthOf(start)}
    group by month order by month`);
  const count = (first: typeof FIRST_SONG) =>
    new Map(db.all<{ month: string; n: number }>(sql`select substr(first_day, 1, 7) as month, count(*) as n from (${first}) group by month`).map((r) => [r.month, r.n]));
  const songs = count(FIRST_SONG);
  const artists = count(FIRST_ARTIST);
  const months = listened.map((m) => ({
    month: m.month,
    hours: hours(m.ms),
    newHours: hours(m.new_ms),
    newShare: rate(m.new_ms, m.ms),
    newArtists: artists.get(m.month) ?? 0,
    newSongs: songs.get(m.month) ?? 0,
  }));
  const ms = listened.reduce((s, m) => s + m.ms, 0);
  const newMs = listened.reduce((s, m) => s + m.new_ms, 0);
  return {
    historyStart: start,
    months,
    totals: {
      hours: hours(ms),
      newHours: hours(newMs),
      newShare: rate(newMs, ms),
      newArtists: months.reduce((s, m) => s + m.newArtists, 0),
      newSongs: months.reduce((s, m) => s + m.newSongs, 0),
    },
  };
}

/** The artists and songs first played in one month, by their hours that month, with what they came to since. */
export function monthDiscoveries(db: Db, { month, limit }: { month: string; limit: number }) {
  const span = { from: `${month}-01`, to: lastOfMonth(month) };
  const songs = db.all<SongRow & { first_day: string; ms_since: number; listens_since: number }>(sql`
    with first_song as (${FIRST_SONG}),
    since as (select t.song_key, sum(${MS}) as ms_since, sum(${LISTEN}) as listens_since from ${MUSIC} where ${musicWhere({ from: span.from })} group by t.song_key)
    select s.*, fs.first_day, since.ms_since, since.listens_since
    from (${songStatsSql(musicWhere(span))}) s
    join first_song fs on fs.song_key = s.song_key and fs.first_day between ${span.from} and ${span.to}
    join since on since.song_key = s.song_key
    order by s.ms desc, s.song_key limit ${limit}`);
  const artists = db.all<{ artist: string; first_day: string; ms: number; listens: number; songs: number; ms_since: number }>(sql`
    with first_artist as (${FIRST_ARTIST}),
    since as (select t.artist, sum(${MS}) as ms_since from ${MUSIC} where ${musicWhere({ from: span.from })} group by t.artist)
    select t.artist, fa.first_day, sum(${MS}) as ms, sum(${LISTEN}) as listens, count(distinct t.song_key) as songs, since.ms_since
    from ${MUSIC} join first_artist fa on fa.artist = t.artist and fa.first_day between ${span.from} and ${span.to}
    join since on since.artist = t.artist
    where ${musicWhere(span)}
    group by t.artist order by ms desc, t.artist limit ${limit}`);
  return {
    month,
    artists: withArtistImages(
      db,
      artists.map((a) => ({ artist: a.artist, firstDay: a.first_day, hours: hours(a.ms), listens: a.listens, songs: a.songs, hoursSince: hours(a.ms_since) })),
    ),
    songs: songs.map((s) => ({ ...songWithStats(s), firstDay: s.first_day, hoursSince: hours(s.ms_since), listensSince: s.listens_since })),
  };
}

/**
 * A comeback: an artist with `beforeHours` or more, then `gapMonths` or more active months (months with `activeMonthHours`
 * of any listening) each under `floorHours` of that artist, then a month at or over the floor and `sinceHours` from it on.
 * Months with no listening at all do not count toward the gap, so a break from everything is not a comeback.
 */
export const COMEBACK = { gapMonths: 6, floorHours: 0.25, beforeHours: 3, sinceHours: 1, activeMonthHours: 1 } as const;

type ArtistMonth = { artist: string; month: string; ms: number; first_day: string; last_day: string };

export function comebacks(db: Db, { range, limit }: { range: Range; limit: number }) {
  const rows = db.all<ArtistMonth>(sql`
    select t.artist, substr(p.day, 1, 7) as month, sum(${MS}) as ms, min(p.day) as first_day, max(p.day) as last_day
    from ${MUSIC} where ${musicWhere({})} group by t.artist, month order by t.artist, month`);
  const active = new Set(
    db
      .all<{ month: string }>(sql`select substr(p.day, 1, 7) as month from ${MUSIC} where ${musicWhere({})} group by month having sum(${MS}) >= ${COMEBACK.activeMonthHours * HOUR_MS}`)
      .map((r) => r.month),
  );
  const months = [...active].sort();
  const byArtist = new Map<string, ArtistMonth[]>();
  for (const r of rows) byArtist.set(r.artist, [...(byArtist.get(r.artist) ?? []), r]);
  const found: { artist: string; lastBefore: string; returned: string; gapMonths: number; hoursBefore: number; hoursSince: number }[] = [];
  for (const [artist, own] of byArtist) {
    const total = own.reduce((s, m) => s + m.ms, 0);
    let before = 0;
    let beforeGap = 0;
    let last: ArtistMonth | null = null;
    let after = total;
    for (const m of own) {
      if (m.ms >= COMEBACK.floorHours * HOUR_MS) {
        const quiet = last ? months.filter((x) => x > last!.month && x < m.month).length : 0;
        if (last && quiet >= COMEBACK.gapMonths && beforeGap >= COMEBACK.beforeHours * HOUR_MS && after >= COMEBACK.sinceHours * HOUR_MS) {
          found.push({ artist, lastBefore: last.last_day, returned: m.first_day, gapMonths: quiet, hoursBefore: hours(beforeGap), hoursSince: hours(after) });
        }
        last = m;
        beforeGap = before + m.ms;
      }
      before += m.ms;
      after -= m.ms;
    }
  }
  const inRange = found.filter((c) => (!range.from || c.returned >= range.from) && (!range.to || c.returned <= range.to));
  inRange.sort((a, b) => b.returned.localeCompare(a.returned) || b.hoursSince - a.hoursSince);
  return {
    rules: COMEBACK,
    items: withArtistImages(db, inRange.slice(0, limit)).map((c) => ({ ...c, gapDays: Math.round((Date.parse(c.returned) - Date.parse(c.lastBefore)) / 86_400_000) })),
  };
}

/** A loyal year: one with `floorHours` or more of the artist. Artists need `minYears` loyal years to be listed. */
export const LOYALTY = { floorHours: 2, minYears: 2 } as const;

export function loyalty(db: Db, { range, limit }: { range: Range; limit: number }) {
  const rows = db.all<{ artist: string; year: string; ms: number }>(sql`
    select t.artist, substr(p.day, 1, 4) as year, sum(${MS}) as ms
    from ${MUSIC} where ${musicWhere(range)} group by t.artist, year order by t.artist, year`);
  const years = [...new Set(rows.map((r) => Number(r.year)))].sort((a, b) => a - b);
  const byArtist = new Map<string, { years: number[]; ms: number }>();
  for (const r of rows) {
    const a = byArtist.get(r.artist) ?? { years: [], ms: 0 };
    a.ms += r.ms;
    if (r.ms >= LOYALTY.floorHours * HOUR_MS) a.years.push(Number(r.year));
    byArtist.set(r.artist, a);
  }
  const items = [...byArtist.entries()]
    .filter(([, a]) => a.years.length >= LOYALTY.minYears)
    .map(([artist, a]) => ({ artist, years: a.years, hours: hours(a.ms), run: longestRun(a.years) }))
    .sort((a, b) => b.years.length - a.years.length || b.run.years - a.run.years || b.hours - a.hours || a.artist.localeCompare(b.artist))
    .slice(0, limit);
  return { rules: LOYALTY, years, items: withArtistImages(db, items) };
}

function longestRun(years: number[]): { from: number; to: number; years: number } {
  let best = { from: years[0]!, to: years[0]!, years: 1 };
  let from = years[0]!;
  for (let i = 1; i < years.length; i++) {
    if (years[i] !== years[i - 1]! + 1) from = years[i]!;
    const length = years[i]! - from + 1;
    if (length > best.years) best = { from, to: years[i]!, years: length };
  }
  return best;
}

/** Recap facts: what was new in a period. Null when the history starts inside it. */
export function periodDiscovery(db: Db, period: { from: string; to: string }) {
  const start = firstDay(db);
  if (!start || start >= period.from) return null;
  const row = db.all<{ ms: number | null; new_ms: number | null; songs: number; artists: number }>(sql`
    with first_song as (${FIRST_SONG}), first_artist as (${FIRST_ARTIST})
    select sum(${MS}) as ms, sum(case when fs.first_day >= ${period.from} then ${MS} else 0 end) as new_ms,
      count(distinct case when fs.first_day >= ${period.from} then t.song_key end) as songs,
      count(distinct case when fa.first_day >= ${period.from} then t.artist end) as artists
    from ${MUSIC} join first_song fs on fs.song_key = t.song_key join first_artist fa on fa.artist = t.artist
    where ${musicWhere(period)}`)[0]!;
  return { newSongs: row.songs, newArtists: row.artists, newHours: hours(row.new_ms ?? 0), newShare: rate(row.new_ms ?? 0, row.ms ?? 0) };
}
