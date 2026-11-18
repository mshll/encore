import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { shiftDay } from "../digest/periods";
import { hours, LISTEN, MS, MUSIC, musicWhere, periodExpr, type Range, withArtistImages } from "./common";

const HOUR_MS = 3_600_000;

/** A new session starts when a play begins more than this long after the one before it ended. */
export const SESSION_GAP_MINUTES = 15;

type Run = { days: number; from: string; to: string };

/** Runs of consecutive days in sorted, distinct days. */
function runs(days: string[]): Run[] {
  const out: Run[] = [];
  for (const day of days) {
    const last = out.at(-1);
    if (last && shiftDay(last.to, 1) === day) {
      last.to = day;
      last.days++;
    } else out.push({ days: 1, from: day, to: day });
  }
  return out;
}

const longest = (all: Run[]): Run | null => all.reduce<Run | null>((best, r) => (!best || r.days > best.days ? r : best), null);

/**
 * Days in a row with at least one listen. `current` is the run that reaches today or yesterday (today may not have
 * listening yet), over all time; `longest` and the artists' runs are within the range.
 */
export function streaks(db: Db, { range, today, limit = 5 }: { range: Range; today: string; limit?: number }) {
  const artistDays = db.all<{ artist: string; day: string }>(sql`
    select distinct t.artist, p.day from ${MUSIC} where ${musicWhere(range)} and ${LISTEN} order by t.artist, p.day`);
  const byArtist = new Map<string, string[]>();
  for (const r of artistDays) byArtist.set(r.artist, [...(byArtist.get(r.artist) ?? []), r.day]);
  const artists = [...byArtist.entries()]
    .map(([artist, d]) => ({ artist, ...longest(runs(d))! }))
    .filter((a) => a.days >= 2)
    .sort((a, b) => b.days - a.days || b.to.localeCompare(a.to) || a.artist.localeCompare(b.artist))
    .slice(0, limit);
  return { today, current: currentStreak(db, today), longest: longestStreak(db, range), artists: withArtistImages(db, artists) };
}

const listeningDays = (db: Db, range: Range) => db.all<{ day: string }>(sql`select distinct p.day from ${MUSIC} where ${musicWhere(range)} and ${LISTEN} order by p.day`).map((d) => d.day);

export const longestStreak = (db: Db, range: Range): Run | null => longest(runs(listeningDays(db, range)));

export function currentStreak(db: Db, today: string): Run | null {
  const last = runs(listeningDays(db, { to: today })).at(-1);
  return last && last.to >= shiftDay(today, -1) ? last : null;
}

type SessionPlay = { ts: number; day: string; ms: number };

/** Plays in order, cut where the gap from one play's end to the next play's start passes `SESSION_GAP_MINUTES`; the longest by wall time. */
function longestSession(plays: SessionPlay[]) {
  const spans: { start: number; end: number; ms: number; plays: number; day: string }[] = [];
  for (const p of plays) {
    const start = p.ts - p.ms;
    let current = spans.at(-1);
    if (!current || start - current.end > SESSION_GAP_MINUTES * 60_000) {
      current = { start, end: p.ts, ms: 0, plays: 0, day: p.day };
      spans.push(current);
    }
    current.start = Math.min(current.start, start);
    current.end = Math.max(current.end, p.ts);
    current.ms += p.ms;
    current.plays++;
  }
  const best = spans.reduce<(typeof spans)[number] | null>((b, s) => (!b || s.end - s.start > b.end - b.start ? s : b), null);
  if (!best) return null;
  return {
    start: new Date(best.start).toISOString(),
    end: new Date(best.end).toISOString(),
    day: best.day,
    minutes: Math.round((best.end - best.start) / 60_000),
    hours: hours(best.ms),
    plays: best.plays,
  };
}

/** The biggest day, week, month, song in a day (by listens) and session in the range. Ties go to the earliest. */
export function records(db: Db, { range }: { range: Range }) {
  const top = (period: "day" | "week" | "month") =>
    db.all<{ period: string; ms: number }>(sql`
      select ${periodExpr(period)} as period, sum(${MS}) as ms from ${MUSIC} where ${musicWhere(range)}
      group by period order by ms desc, period limit 1`)[0];
  const day = top("day");
  const week = top("week");
  const month = top("month");
  const song = db.all<{ day: string; listens: number; song_key: string; uri: string; name: string; artist: string; album_art_url: string | null }>(sql`
    select p.day, sum(${LISTEN}) as listens, t.song_key, min(t.uri) as uri, min(t.name) as name, min(t.artist) as artist, max(t.album_art_url) as album_art_url
    from ${MUSIC} where ${musicWhere(range)}
    group by p.day, t.song_key order by listens desc, p.day, t.song_key limit 1`)[0];
  const plays = db.all<SessionPlay>(sql`select p.ts, p.day, ${MS} as ms from ${MUSIC} where ${musicWhere(range)} order by p.ts, p.id`);
  return {
    sessionGapMinutes: SESSION_GAP_MINUTES,
    day: day ? { day: day.period, hours: hours(day.ms) } : null,
    week: week ? { week: week.period, hours: hours(week.ms) } : null,
    month: month ? { month: month.period, hours: hours(month.ms) } : null,
    songDay:
      song && song.listens > 0
        ? { day: song.day, listens: song.listens, song: { songKey: song.song_key, uri: song.uri, name: song.name, artist: song.artist, albumArtUrl: song.album_art_url } }
        : null,
    session: longestSession(plays),
  };
}

/** Song listens, artist hours and total hours a milestone marks. */
export const MILESTONES = {
  songListens: [10, 25, 50, 100, 250, 500, 1000],
  artistHours: [10, 50, 100, 250, 500, 1000],
  totalHours: [100, 500, 1000, 2500, 5000, 10000],
} as const;

export const KIND_ORDER = { total: 3, artist: 2, song: 1 } as const;

const values = (list: readonly number[]) => sql.raw(list.map((n) => `select ${n} as n`).join(" union all "));

export type Milestone =
  | { kind: "song"; threshold: number; day: string; song: { songKey: string; uri: string; name: string; artist: string; albumArtUrl: string | null } }
  | { kind: "artist"; threshold: number; day: string; artist: string; imageUrl: string | null }
  | { kind: "total"; threshold: number; day: string };

/** Every threshold crossed on a day in the range, newest first: a song's 10th listen, an artist's 50th hour, the 1000th hour overall. */
export function milestones(db: Db, { range, limit }: { range: Range; limit: number }): { thresholds: typeof MILESTONES; items: Milestone[] } {
  const inRange = (day: string) => (!range.from || day >= range.from) && (!range.to || day <= range.to);
  const songs = db.all<{ n: number; day: string; ts: number; song_key: string; uri: string; name: string; artist: string; album_art_url: string | null }>(sql`
    with th as (${values(MILESTONES.songListens)})
    select x.* from (
      select row_number() over (partition by t.song_key order by p.ts, p.id) as n, p.day, p.ts, t.song_key, t.uri, t.name, t.artist, t.album_art_url
      from ${MUSIC} where ${musicWhere({})} and ${LISTEN}) x
    where x.n in (select n from th)`);
  const crossings = (partition: string) =>
    db.all<{ n: number; day: string; ts: number; artist: string | null }>(sql`
      with th as (${values(partition ? MILESTONES.artistHours : MILESTONES.totalHours)}),
      x as materialized (
        select p.day, p.ts, ${partition ? sql`t.artist` : sql`null`} as artist,
          sum(${MS}) over (${sql.raw(partition)} order by p.ts, p.id rows unbounded preceding) as cum, ${MS} as ms
        from ${MUSIC} where ${musicWhere({})})
      select th.n, x.day, x.ts, x.artist from x join th on x.cum >= th.n * ${HOUR_MS} and x.cum - x.ms < th.n * ${HOUR_MS}`);
  const items: (Milestone & { ts: number })[] = [
    ...songs.map((s) => ({
      kind: "song" as const,
      threshold: s.n,
      day: s.day,
      ts: s.ts,
      song: { songKey: s.song_key, uri: s.uri, name: s.name, artist: s.artist, albumArtUrl: s.album_art_url },
    })),
    ...withArtistImages(
      db,
      crossings("partition by t.artist").map((a) => ({ kind: "artist" as const, threshold: a.n, day: a.day, ts: a.ts, artist: a.artist! })),
    ),
    ...crossings("").map((a) => ({ kind: "total" as const, threshold: a.n, day: a.day, ts: a.ts })),
  ];
  return {
    thresholds: MILESTONES,
    items: items
      .filter((m) => inRange(m.day))
      .sort((a, b) => b.ts - a.ts || KIND_ORDER[b.kind] - KIND_ORDER[a.kind] || b.threshold - a.threshold)
      .slice(0, limit)
      .map(({ ts: _ts, ...m }) => m),
  };
}

/** All-time records whose day falls inside a span, in the order they matter to the owner. */
export function recordsSetIn(db: Db, span: { from: string; to: string }) {
  const all = records(db, { range: {} });
  const set: ({ record: "day"; day: string; hours: number } | { record: "session"; day: string; minutes: number; hours: number } | { record: "songDay"; day: string; listens: number; song: NonNullable<typeof all.songDay>["song"] } | { record: "week"; week: string; hours: number } | { record: "month"; month: string; hours: number })[] = [];
  const within = (day: string) => day >= span.from && day <= span.to;
  if (all.day && within(all.day.day)) set.push({ record: "day", ...all.day });
  if (all.session && within(all.session.day)) set.push({ record: "session", day: all.session.day, minutes: all.session.minutes, hours: all.session.hours });
  if (all.songDay && within(all.songDay.day)) set.push({ record: "songDay", ...all.songDay });
  if (all.week && all.week.week <= span.to && shiftDay(all.week.week, 6) >= span.from) set.push({ record: "week", ...all.week });
  if (all.month && all.month.month >= span.from.slice(0, 7) && all.month.month <= span.to.slice(0, 7)) set.push({ record: "month", ...all.month });
  return set;
}
