import { sql } from "drizzle-orm";
import { MS, MUSIC, musicWhere } from "../analytics/common";
import { overview } from "../analytics/overview";
import { topArtists, topTracks } from "../analytics/top";
import type { Db } from "../db/client";
import { localTime } from "../plays/localTime";

export type Window = { from: string; to: string };

const DAY_MS = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export const daysIn = (w: Window) => Math.round((Date.parse(w.to) - Date.parse(w.from)) / DAY_MS) + 1;

/** The 7 local days before `today`, against the 28 days before those. */
export function weeklyWindows(today: string) {
  return { period: { from: shiftDay(today, -7), to: shiftDay(today, -1) }, baseline: { from: shiftDay(today, -35), to: shiftDay(today, -8) } };
}

/** The calendar month before `today`, against the three months before it. */
export function monthlyWindows(today: string) {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const monthStart = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const start = monthStart(y, m - 1);
  const end = shiftDay(monthStart(y, m), -1);
  return { period: { from: start, to: end }, baseline: { from: monthStart(y, m - 4), to: shiftDay(start, -1) } };
}

function shares(db: Db, column: "genres" | "moods", w: Window) {
  const rows = db.all<{ value: string; ms: number }>(sql`
    select j.value as value, sum(${MS}) as ms from ${MUSIC} join track_tags tg on tg.song_key = t.song_key, json_each(tg.${sql.raw(column)}) j
    where ${musicWhere(w)} group by j.value`);
  const total = db.all<{ ms: number | null }>(sql`select sum(${MS}) as ms from ${MUSIC} join track_tags tg on tg.song_key = t.song_key where ${musicWhere(w)}`)[0]?.ms ?? 0;
  return new Map(rows.map((r) => [r.value, total ? r.ms / total : 0]));
}

function shareChanges(db: Db, column: "genres" | "moods", period: Window, baseline: Window) {
  const now = shares(db, column, period);
  const before = shares(db, column, baseline);
  return [...now.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([value, share]) => ({ value, sharePct: r1(share * 100), baselineSharePct: r1((before.get(value) ?? 0) * 100), changePts: r1((share - (before.get(value) ?? 0)) * 100) }));
}

function mood(db: Db, w: Window) {
  const r = db.all<{ energy: number | null; valence: number | null }>(sql`
    select avg(tg.energy) as energy, avg(tg.valence) as valence from ${MUSIC} join track_tags tg on tg.song_key = t.song_key
    where ${musicWhere(w)} and (p.source = 'api' or p.ms_played >= 30000)`)[0];
  return { energy: r?.energy == null ? null : r1(r.energy), valence: r?.valence == null ? null : r1(r.valence) };
}

function firsts(db: Db, w: Window, key: "t.artist" | "t.song_key", limit: number) {
  const k = sql.raw(key);
  const rows = db.all<{ key: string; name: string; artist: string; listens: number }>(sql`
    select ${k} as key, min(t.name) as name, min(t.artist) as artist, sum(p.source = 'api' or p.ms_played >= 30000) as listens
    from ${MUSIC} where ${musicWhere(w)} and ${k} not in (select ${k} from ${MUSIC} where ${musicWhere({}, sql`p.day < ${w.from}`)})
    group by ${k} order by listens desc`);
  return {
    count: rows.length,
    top: rows.slice(0, limit).map((r) => (key === "t.artist" ? { artist: r.artist, listens: r.listens } : { name: r.name, artist: r.artist, listens: r.listens })),
  };
}

/** Every number the digest may mention, computed here so the model only phrases them. Baseline values are scaled to the period's length. */
export function digestFacts(db: Db, timezone: string, period: Window, baseline: Window) {
  const scale = daysIn(period) / daysIn(baseline);
  const now = overview(db, { range: period });
  const before = overview(db, { range: baseline });
  const periodArtists = topArtists(db, { range: period, limit: 40 });
  const baselineArtists = new Map(topArtists(db, { range: baseline, limit: 200 }).map((a) => [a.artist, a.hours * scale]));
  const artistRows = periodArtists.map((a) => ({ artist: a.artist, hours: r1(a.hours), baselineHours: r1(baselineArtists.get(a.artist) ?? 0) }));
  const periodHours = new Map(periodArtists.map((a) => [a.artist, a.hours]));
  const fading = [...baselineArtists.entries()]
    .slice(0, 12)
    .map(([artist, hours]) => ({ artist, hours: r1(periodHours.get(artist) ?? 0), baselineHours: r1(hours) }))
    .filter((a) => a.baselineHours - a.hours >= 0.5)
    .sort((a, b) => b.baselineHours - b.hours - (a.baselineHours - a.hours))
    .slice(0, 3);
  const busiest = db.all<{ day: string; ms: number }>(sql`select p.day, sum(${MS}) as ms from ${MUSIC} where ${musicWhere(period)} group by p.day order by ms desc limit 1`)[0];
  const peakHour = db.all<{ hour: number; ms: number }>(sql`select p.hour, sum(${MS}) as ms from ${MUSIC} where ${musicWhere(period)} group by p.hour order by ms desc limit 1`)[0];
  const inPeriod = (ts: number) => {
    const d = localTime(ts, timezone).day;
    return d >= period.from && d <= period.to;
  };
  const periodPicks = db.all<{ created_at: number; plays: number }>(sql`select created_at, plays from picks`).filter((p) => inPeriod(p.created_at));
  const setsBuilt = db.all<{ created_at: number }>(sql`select created_at from sets where version > 0`).filter((s) => inPeriod(s.created_at)).length;
  return {
    period: { ...period, days: daysIn(period) },
    baseline: { ...baseline, days: daysIn(baseline), note: "baseline numbers are scaled to the period length" },
    totals: {
      hours: r1(now.hours),
      baselineHours: r1(before.hours * scale),
      listens: now.listens,
      baselineListens: Math.round(before.listens * scale),
      uniqueArtists: now.uniqueArtists,
      uniqueSongs: now.uniqueTracks,
      skipRate: now.skipRate,
      baselineSkipRate: before.skipRate,
    },
    topArtists: artistRows.slice(0, 8),
    risingArtists: artistRows
      .filter((a) => a.hours - a.baselineHours >= 0.5)
      .sort((a, b) => b.hours - b.baselineHours - (a.hours - a.baselineHours))
      .slice(0, 3),
    fadingArtists: fading,
    newArtists: firsts(db, period, "t.artist", 5),
    newSongs: firsts(db, period, "t.song_key", 5),
    topSongs: topTracks(db, { range: period, limit: 8, sort: "listens" }).map((s) => ({ name: s.name, artist: s.artist, listens: s.listens, skipRate: s.skipRate })),
    genres: shareChanges(db, "genres", period, baseline),
    moods: shareChanges(db, "moods", period, baseline),
    energyValence: { period: mood(db, period), baseline: mood(db, baseline), scale: "1-5" },
    busiestDay: busiest ? { day: busiest.day, hours: r1(busiest.ms / 3_600_000) } : null,
    peakHour: peakHour ? { hour: peakHour.hour, hours: r1(peakHour.ms / 3_600_000) } : null,
    assistant: { picksMade: periodPicks.length, picksPlayed: periodPicks.filter((p) => p.plays > 0).length, setsBuilt },
    skipRateDelta: now.skipRate !== null && before.skipRate !== null ? r3(now.skipRate - before.skipRate) : null,
  };
}

export type DigestFacts = ReturnType<typeof digestFacts>;
