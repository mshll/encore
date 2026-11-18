import { sql } from "drizzle-orm";
import { MS, MUSIC, musicWhere } from "../analytics/common";
import type { Db } from "../db/client";
import { digests } from "../db/schema";
import { historyStart, isRecapFacts, type LegacyFacts, type RecapFacts } from "./facts";
import { baselineSpan, coveredSpan, humanDatesIn, latestKey, periodLabel, periodSpan, shiftDay, shiftKey, type RecapKind, type Span } from "./periods";

const DAY_MS = 86_400_000;

export type TimelineRow = {
  kind: RecapKind;
  key: string;
  label: string;
  from: string;
  to: string;
  inProgress: boolean;
  /** Hours of music the period covers today, and in the same stretch of the period before (null without history there). */
  hours: number;
  before: number | null;
  /** The stored recap: its written headline (null for figures only), the top artist, and whether days have passed since it was written. */
  recap: { id: number; headline: string | null; topArtist: string | null; stale: boolean } | null;
};

export type Timeline = {
  historyStart: string | null;
  /** The week and month still going, and the weeks that ended inside that month. */
  current: { week: TimelineRow | null; month: TimelineRow | null; weeks: TimelineRow[] };
  years: { year: TimelineRow; months: { month: TimelineRow; weeks: TimelineRow[] }[] }[];
};

type Stored = typeof digests.$inferSelect;

/** Hours over any span of days, from one pass over the daily totals. */
function hoursCounter(db: Db, start: string, today: string): (span: Span) => number {
  const index = (day: string) => Math.round((Date.parse(day) - Date.parse(start)) / DAY_MS);
  const cumulative = new Float64Array(index(today) + 2);
  for (const r of db.all<{ day: string; ms: number }>(sql`select p.day, sum(${MS}) as ms from ${MUSIC} where ${musicWhere({})} group by p.day`)) {
    const i = index(r.day);
    if (i >= 0 && i < cumulative.length - 1) cumulative[i + 1] = r.ms;
  }
  for (let i = 1; i < cumulative.length; i++) cumulative[i]! += cumulative[i - 1]!;
  const at = (i: number) => cumulative[Math.max(0, Math.min(cumulative.length - 1, i))]!;
  return (span) => (at(index(span.to) + 1) - at(index(span.from))) / 3_600_000;
}

function recapOf(d: Stored, covered: Span & { inProgress: boolean }): TimelineRow["recap"] {
  if (isRecapFacts(d.facts)) {
    const f = d.facts as RecapFacts;
    return { id: d.id, headline: d.lines?.headline?.trim() || null, topArtist: f.artists[0]?.artist ?? null, stale: f.period.inProgress && d.toDay < covered.to };
  }
  const first = d.text.split(/\n+/).map((l) => l.trim()).find(Boolean);
  return { id: d.id, headline: first ? humanDatesIn(first) : null, topArtist: (d.facts as LegacyFacts).topArtists?.[0]?.artist ?? null, stale: false };
}

/**
 * Every period the history reaches, for the Recaps timeline: the week and month still going first, then each year
 * with its months and each month with its weeks, newest first. Weeks sit under the month their last day is in; a week
 * recapped under an earlier recap weekday keeps its own place beside the weeks of today's.
 */
export function recapTimeline(db: Db, today: string, recapWeekday: number): Timeline {
  const start = historyStart(db);
  if (!start) return { historyStart: null, current: { week: null, month: null, weeks: [] }, years: [] };
  const hoursIn = hoursCounter(db, start, today);
  const stored = new Map(db.select().from(digests).all().map((d) => [`${d.kind}:${d.periodKey}`, d]));
  const row = (kind: RecapKind, key: string): TimelineRow | null => {
    const covered = coveredSpan(kind, key, today);
    if (!covered || covered.to < start) return null;
    const baseline = baselineSpan(kind, key, covered);
    const d = stored.get(`${kind}:${key}`);
    return {
      kind,
      key,
      label: periodLabel(kind, key),
      from: covered.from,
      to: covered.to,
      inProgress: covered.inProgress,
      hours: hoursIn(covered),
      before: start <= baseline.from ? hoursIn(baseline) : null,
      recap: d ? recapOf(d, covered) : null,
    };
  };

  const thisWeek = shiftKey("weekly", latestKey("weekly", today, recapWeekday), 1);
  const thisMonth = today.slice(0, 7);

  const weekKeys = new Set<string>();
  for (let key = latestKey("weekly", today, recapWeekday); periodSpan("weekly", key).to >= start; key = shiftDay(key, -7)) weekKeys.add(key);
  for (const d of stored.values()) if (d.kind === "weekly" && d.periodKey < thisWeek) weekKeys.add(d.periodKey);
  const weeks = new Map<string, TimelineRow[]>();
  for (const key of [...weekKeys].sort().reverse()) {
    const r = row("weekly", key);
    if (r) weeks.set(key.slice(0, 7), [...(weeks.get(key.slice(0, 7)) ?? []), r]);
  }

  const years: Timeline["years"] = [];
  for (let year = Number(today.slice(0, 4)); year >= Number(start.slice(0, 4)); year--) {
    const yearRow = row("yearly", String(year));
    if (!yearRow) continue;
    const months: Timeline["years"][number]["months"] = [];
    for (let m = 12; m >= 1; m--) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const monthRow = key === thisMonth ? null : row("monthly", key);
      if (monthRow) months.push({ month: monthRow, weeks: weeks.get(key) ?? [] });
    }
    years.push({ year: yearRow, months });
  }
  return { historyStart: start, current: { week: row("weekly", thisWeek), month: row("monthly", thisMonth), weeks: weeks.get(thisMonth) ?? [] }, years };
}
