import { sql } from "drizzle-orm";
import { LISTEN, MS, MUSIC, musicWhere } from "../analytics/common";
import { comebacks, periodDiscovery } from "../analytics/discovery";
import { overview } from "../analytics/overview";
import { longestStreak, milestones, recordsSetIn } from "../analytics/records";
import { tagShares } from "../analytics/tags";
import { topArtists, topTracks } from "../analytics/top";
import { yearCompare } from "../analytics/years";
import type { Db } from "../db/client";
import { daysIn, shiftDay, type RecapKind, type Span } from "./periods";

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const hoursOf = (ms: number) => ms / 3_600_000;

export type Totals = { hours: number; listens: number; artists: number; songs: number };
export type ArtistHours = { artist: string; hours: number; before: number | null };
export type Share = { value: string; share: number; before: number | null };
export type YearSide = { year: number; hours: number; plays: number; artists: number; newArtists: number; newSongs: number };
type YearRank = { rank: number; hours: number };
/** A year against the year before, as `stats/years` compares them, kept with the recap so the page does not compute it again. */
export type YearFacts = {
  a: YearSide;
  b: YearSide;
  artists: { artist: string; a: YearRank | null; b: YearRank | null; change: number | null }[];
  genres: { value: string; a: number; b: number }[];
  moods: { value: string; a: number; b: number }[];
};
export type Find = { count: number; ofNew: number; top: { key: string; name: string; artist: string; uri: string; listens: number; days: number }[] };

/** Every number a recap shows, computed here: Claude only words them, the page draws them. */
export type RecapFacts = {
  version: 2;
  kind: RecapKind;
  period: Span & { days: number; inProgress: boolean };
  /** The same stretch of the period before, or null when the history does not reach back over all of it. */
  baseline: (Span & { days: number }) | null;
  historyStart: string | null;
  totals: Totals & { before: Totals | null };
  /** Hours per day of the period, in order. */
  daily: number[];
  artists: (ArtistHours & { listens: number })[];
  movers: { up: ArtistHours[]; down: ArtistHours[] };
  songs: { songKey: string; uri: string; name: string; artist: string; listens: number; hours: number }[];
  /** Songs and artists first played in the period and played again on another day of it. Null without earlier history. */
  finds: { songs: Find; artists: Find } | null;
  genres: Share[];
  moods: Share[];
  busiest: { day: { day: string; hours: number } | null; hour: { hour: number; hours: number } | null; byHour: number[] };
  /** Yearly only: each month with listening. */
  months: { month: string; hours: number; artist: string | null; song: { name: string; artist: string } | null }[];
  /** The fields below came after version 2: recaps stored before have none of them. */
  /** New artists and songs of the period and the share of hours on songs first heard in it. Null without earlier history. */
  discovery?: ReturnType<typeof periodDiscovery>;
  /** Artists back after a long gap, returning inside the period. */
  comebacks?: ReturnType<typeof comebacks>["items"];
  /** All-time records set inside the period, and the longest run of days with listening in it. */
  records?: ReturnType<typeof recordsSetIn>;
  streak?: ReturnType<typeof longestStreak>;
  /** Thresholds crossed inside the period, newest first. */
  milestones?: ReturnType<typeof milestones>["items"];
  /** Yearly only: the year against the year before, null when the year before has no listening. */
  years?: YearFacts | null;
};

/** The first day with a song play, or null before any import. */
export function historyStart(db: Db): string | null {
  return db.all<{ day: string | null }>(sql`select min(p.day) as day from plays p where p.kind = 'track'`)[0]?.day ?? null;
}

function totals(db: Db, range: Span): Totals {
  const o = overview(db, { range });
  return { hours: o.hours, listens: o.listens, artists: o.uniqueArtists, songs: o.uniqueTracks };
}

function daily(db: Db, period: Span): number[] {
  const rows = new Map(db.all<{ day: string; ms: number }>(sql`select p.day, sum(${MS}) as ms from ${MUSIC} where ${musicWhere(period)} group by p.day`).map((r) => [r.day, r.ms]));
  return Array.from({ length: daysIn(period) }, (_, i) => hoursOf(rows.get(shiftDay(period.from, i)) ?? 0));
}

/** With a baseline, the tags whose share moved most; without one, the largest. */
function shareChanges(db: Db, column: "genres" | "moods", period: Span, baseline: Span | null): Share[] {
  const now = tagShares(db, column, period);
  const before = baseline ? tagShares(db, column, baseline) : null;
  const rows = [...new Set([...now.keys(), ...(before?.keys() ?? [])])].map((value) => ({
    value,
    share: r3(now.get(value) ?? 0),
    before: before ? r3(before.get(value) ?? 0) : null,
  }));
  const weight = (s: Share) => (s.before === null ? s.share : Math.abs(s.share - s.before));
  return rows.sort((a, b) => weight(b) - weight(a) || b.share - a.share).slice(0, 6);
}

function finds(db: Db, period: Span, column: "t.song_key" | "t.artist"): Find {
  const k = sql.raw(column);
  const rows = db.all<{ key: string; name: string; artist: string; uri: string; listens: number; days: number }>(sql`
    select ${k} as key, min(t.name) as name, min(t.artist) as artist, min(t.uri) as uri,
      sum(${LISTEN}) as listens, count(distinct case when ${LISTEN} then p.day end) as days
    from ${MUSIC} where ${musicWhere(period)} and ${k} not in (select ${k} from ${MUSIC} where ${musicWhere({}, sql`p.day < ${period.from}`)})
    group by ${k} order by listens desc, key`);
  const stuck = rows.filter((r) => r.days >= 2);
  return { count: stuck.length, ofNew: rows.length, top: stuck.slice(0, 5) };
}

function movers(period: (ArtistHours & { listens: number })[], before: Map<string, number>, periodHours: number) {
  const now = new Map(period.map((a) => [a.artist, a.hours]));
  const all = [...new Set([...now.keys(), ...before.keys()])].map((artist) => ({ artist, hours: now.get(artist) ?? 0, before: before.get(artist) ?? 0 }));
  const enough = Math.max(0.5, periodHours * 0.02);
  const by = (sign: 1 | -1) =>
    all
      .filter((a) => sign * (a.hours - a.before!) >= enough)
      .sort((a, b) => sign * (b.hours - b.before! - (a.hours - a.before!)))
      .slice(0, 3);
  return { up: by(1), down: by(-1) };
}

function months(db: Db, period: Span): RecapFacts["months"] {
  const where = musicWhere(period);
  const hours = db.all<{ month: string; ms: number }>(sql`select substr(p.day, 1, 7) as month, sum(${MS}) as ms from ${MUSIC} where ${where} group by month order by month`);
  const artists = new Map(
    db
      .all<{ month: string; artist: string }>(sql`
        select month, artist from (
          select substr(p.day, 1, 7) as month, t.artist, row_number() over (partition by substr(p.day, 1, 7) order by sum(${MS}) desc, t.artist) as rn
          from ${MUSIC} where ${where} group by month, t.artist)
        where rn = 1`)
      .map((r) => [r.month, r.artist]),
  );
  const songs = new Map(
    db
      .all<{ month: string; name: string; artist: string }>(sql`
        select month, name, artist from (
          select substr(p.day, 1, 7) as month, min(t.name) as name, min(t.artist) as artist,
            row_number() over (partition by substr(p.day, 1, 7) order by sum(${LISTEN}) desc, sum(${MS}) desc, t.song_key) as rn
          from ${MUSIC} where ${where} group by month, t.song_key)
        where rn = 1`)
      .map((r) => [r.month, { name: r.name, artist: r.artist }]),
  );
  return hours.map((m) => ({ month: m.month, hours: hoursOf(m.ms), artist: artists.get(m.month) ?? null, song: songs.get(m.month) ?? null }));
}

function yearFacts(db: Db, year: number): YearFacts | null {
  const c = yearCompare(db, { a: year - 1, b: year });
  if (!c.years.includes(year - 1)) return null;
  const side = ({ year, hours, plays, artists, newArtists, newSongs }: YearSide): YearSide => ({ year, hours, plays, artists, newArtists, newSongs });
  const artists = c.artists
    .filter((a) => a.b !== null)
    .sort((x, y) => x.b!.rank - y.b!.rank)
    .map(({ artist, a, b, change }) => ({ artist, a, b, change }));
  return { a: side(c.a), b: side(c.b), artists, genres: c.genres, moods: c.moods };
}

export function recapFacts(db: Db, kind: RecapKind, period: Span & { inProgress: boolean }, baseline: Span | null): RecapFacts {
  const start = historyStart(db);
  const now = totals(db, period);
  const artists = topArtists(db, { range: period, limit: 40 }).map((a) => ({ artist: a.artist, hours: a.hours, listens: a.listens, before: null as number | null }));
  const beforeHours = new Map(baseline ? topArtists(db, { range: baseline, limit: 200 }).map((a) => [a.artist, a.hours]) : []);
  if (baseline) for (const a of artists) a.before = beforeHours.get(a.artist) ?? 0;
  const day = db.all<{ day: string; ms: number }>(sql`select p.day, sum(${MS}) as ms from ${MUSIC} where ${musicWhere(period)} group by p.day order by ms desc, p.day limit 1`)[0];
  const byHour = new Map(db.all<{ hour: number; ms: number }>(sql`select p.hour, sum(${MS}) as ms from ${MUSIC} where ${musicWhere(period)} group by p.hour`).map((r) => [r.hour, r.ms]));
  const peak = [...byHour.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return {
    version: 2,
    kind,
    period: { from: period.from, to: period.to, days: daysIn(period), inProgress: period.inProgress },
    baseline: baseline ? { ...baseline, days: daysIn(baseline) } : null,
    historyStart: start,
    totals: { ...now, before: baseline ? totals(db, baseline) : null },
    daily: daily(db, period),
    artists: artists.slice(0, 8),
    movers: baseline ? movers(artists, beforeHours, now.hours) : { up: [], down: [] },
    songs: topTracks(db, { range: period, limit: 8, sort: "listens" }).map((s) => ({ songKey: s.songKey, uri: s.uri, name: s.name, artist: s.artist, listens: s.listens, hours: s.hours })),
    finds: start !== null && start < period.from ? { songs: finds(db, period, "t.song_key"), artists: finds(db, period, "t.artist") } : null,
    genres: shareChanges(db, "genres", period, baseline),
    moods: shareChanges(db, "moods", period, baseline),
    busiest: {
      day: day ? { day: day.day, hours: hoursOf(day.ms) } : null,
      hour: peak ? { hour: peak[0], hours: hoursOf(peak[1]) } : null,
      byHour: Array.from({ length: 24 }, (_, h) => hoursOf(byHour.get(h) ?? 0)),
    },
    months: kind === "yearly" ? months(db, period) : [],
    discovery: periodDiscovery(db, period),
    comebacks: comebacks(db, { range: period, limit: kind === "yearly" ? 50 : 10 }).items,
    records: start !== null && start < period.from ? recordsSetIn(db, period) : [],
    streak: longestStreak(db, period),
    milestones: milestones(db, { range: period, limit: 10 }).items,
    years: kind === "yearly" ? yearFacts(db, Number(period.from.slice(0, 4))) : null,
  };
}

/** Facts stored before recaps became pages: baseline values are scaled to the period's length. */
export type LegacyFacts = {
  period: { from: string; to: string; days: number };
  baseline?: { from: string; to: string; days: number };
  totals?: { hours: number; baselineHours: number; listens: number; baselineListens: number; uniqueArtists: number; uniqueSongs: number };
  topArtists?: { artist: string; hours: number; baselineHours: number }[];
  risingArtists?: { artist: string; hours: number; baselineHours: number }[];
  fadingArtists?: { artist: string; hours: number; baselineHours: number }[];
  newArtists?: { count: number; top: { artist: string; listens: number }[] };
  newSongs?: { count: number; top: { name: string; artist: string; listens: number }[] };
  topSongs?: { name: string; artist: string; listens: number }[];
  genres?: { value: string; sharePct: number; baselineSharePct: number }[];
  moods?: { value: string; sharePct: number; baselineSharePct: number }[];
  busiestDay?: { day: string; hours: number } | null;
  peakHour?: { hour: number; hours: number } | null;
};

export const isRecapFacts = (facts: unknown): facts is RecapFacts => (facts as { version?: unknown } | null)?.version === 2;
