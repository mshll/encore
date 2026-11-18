import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hours, MS, MUSIC, musicWhere, type Range } from "./common";
import { longestSession, SESSION_GAP_MINUTES, sessionPlays, sessionSpans } from "./records";
import { listeningYears } from "./years";

export type CalendarDay = { day: string; hours: number; plays: number };

/** Hours and plays on each local day of one calendar year with music; `year` defaults to the latest year with music. */
export function calendar(db: Db, { year }: { year?: number }): { years: number[]; year: number | null; days: CalendarDay[] } {
  const years = listeningYears(db);
  const picked = year ?? years.at(-1) ?? null;
  if (picked === null) return { years, year: null, days: [] };
  const days = db.all<{ day: string; ms: number; plays: number }>(sql`
    select p.day, sum(${MS}) as ms, count(*) as plays from ${MUSIC}
    where ${musicWhere({ from: `${picked}-01-01`, to: `${picked}-12-31` })}
    group by p.day order by p.day`);
  return { years, year: picked, days: days.map((d) => ({ day: d.day, hours: hours(d.ms), plays: d.plays })) };
}

/** Each listening session in the range (the rule Records uses): how long one runs, how many a day with one, when one starts, the longest. */
export function listeningSessions(db: Db, { range }: { range: Range }) {
  const spans = sessionSpans(sessionPlays(db, range));
  const startHours = Array.from({ length: 24 }, () => 0);
  for (const s of spans) startHours[s.hour]!++;
  const days = new Set(spans.map((s) => s.day)).size;
  const minutes = spans.reduce((sum, s) => sum + (s.end - s.start) / 60_000, 0);
  const peak = Math.max(...startHours);
  return {
    gapMinutes: SESSION_GAP_MINUTES,
    count: spans.length,
    days,
    perDay: days ? Math.round((spans.length / days) * 100) / 100 : null,
    averageMinutes: spans.length ? Math.round(minutes / spans.length) : null,
    usualStart: peak > 0 ? startHours.indexOf(peak) : null,
    startHours,
    longest: longestSession(spans),
  };
}
