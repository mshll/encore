export const RECAP_KINDS = ["weekly", "monthly", "yearly"] as const;
export type RecapKind = (typeof RECAP_KINDS)[number];

export type Span = { from: string; to: string };

const DAY_MS = 86_400_000;
const WEEK_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_KEY = /^\d{4}$/;

export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export const daysIn = (s: Span): number => Math.round((Date.parse(s.to) - Date.parse(s.from)) / DAY_MS) + 1;

/** ISO weekday (1 Monday to 7 Sunday) of a day. */
export const weekdayOf = (day: string): number => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

const lastOfMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

export function isRecapKey(kind: RecapKind, key: string): boolean {
  const pattern = kind === "weekly" ? WEEK_KEY : kind === "monthly" ? MONTH_KEY : YEAR_KEY;
  if (!pattern.test(key)) return false;
  return kind !== "weekly" || new Date(`${key}T00:00:00Z`).toISOString().slice(0, 10) === key;
}

/** The whole period a key names. A week is the seven days ending on its key. */
export function periodSpan(kind: RecapKind, key: string): Span {
  if (kind === "weekly") return { from: shiftDay(key, -6), to: key };
  if (kind === "monthly") return { from: `${key}-01`, to: lastOfMonth(key) };
  return { from: `${key}-01-01`, to: `${key}-12-31` };
}

export function shiftKey(kind: RecapKind, key: string, by: number): string {
  if (kind === "weekly") return shiftDay(key, 7 * by);
  if (kind === "monthly") return shiftMonth(key, by);
  return String(Number(key) + by);
}

/** Weeks end the day before the recap weekday, so a weekly recap covers the seven days up to the morning it is written. */
export const weekEndDay = (recapWeekday: number): number => ((recapWeekday + 5) % 7) + 1;

/** The newest period that has ended by `today`, or the current year, which can be recapped while it runs. */
export function latestKey(kind: RecapKind, today: string, recapWeekday: number): string {
  if (kind === "yearly") return today.slice(0, 4);
  if (kind === "monthly") return shiftMonth(today.slice(0, 7), -1);
  const end = weekEndDay(recapWeekday);
  const back = (weekdayOf(today) - end + 7) % 7 || 7;
  return shiftDay(today, -back);
}

/**
 * What the period covers on `today`: the whole period once it has ended, the days so far of the period still
 * going (up to yesterday), and null when nothing of it has passed.
 */
export function coveredSpan(kind: RecapKind, key: string, today: string): (Span & { inProgress: boolean }) | null {
  const whole = periodSpan(kind, key);
  if (whole.to < today) return { ...whole, inProgress: false };
  const yesterday = shiftDay(today, -1);
  return yesterday >= whole.from ? { from: whole.from, to: yesterday, inProgress: true } : null;
}

/**
 * The same stretch of the period before: the previous week or month, as many days into it as the period covers,
 * or the previous year up to the same day.
 */
export function baselineSpan(kind: RecapKind, key: string, covered: Span): Span {
  const before = periodSpan(kind, shiftKey(kind, key, -1));
  if (kind !== "yearly") {
    const to = shiftDay(before.from, daysIn(covered) - 1);
    return { from: before.from, to: to < before.to ? to : before.to };
  }
  const to = `${before.from.slice(0, 4)}${covered.to.slice(4)}`;
  return { from: before.from, to: to.endsWith("02-29") ? `${to.slice(0, 8)}28` : to };
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayNoYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayOnly = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const at = (day: string) => new Date(`${day}T00:00:00Z`);

/** "22 Oct 2026". */
export const humanDay = (day: string): string => dayFmt.format(at(day));
/** "Thursday 22 October". */
export const humanLongDay = (day: string): string => longDay.format(at(day));

/** "7 – 13 Nov 2026", "28 Oct – 3 Nov 2026", "29 Dec 2025 – 4 Jan 2026". */
export function humanSpan(s: Span): string {
  if (s.from === s.to) return humanDay(s.from);
  if (s.from.slice(0, 7) === s.to.slice(0, 7)) return `${dayOnly.format(at(s.from))} – ${humanDay(s.to)}`;
  if (s.from.slice(0, 4) === s.to.slice(0, 4)) return `${dayNoYear.format(at(s.from))} – ${humanDay(s.to)}`;
  return `${humanDay(s.from)} – ${humanDay(s.to)}`;
}

/** The period's name: "7 – 13 Nov 2026", "October 2026", "2026". */
export function periodLabel(kind: RecapKind, key: string): string {
  if (kind === "weekly") return humanSpan(periodSpan(kind, key));
  if (kind === "monthly") return monthFmt.format(at(`${key}-01`));
  return key;
}

/** How a period is named next to its numbers: "the week before", "September 2026", "1 – 17 Oct 2026", "2025 to 15 Nov". */
export function baselineLabel(kind: RecapKind, key: string, baseline: Span, inProgress: boolean): string {
  if (kind === "weekly") return inProgress ? "the same days the week before" : "the week before";
  if (kind === "monthly") return inProgress ? humanSpan(baseline) : periodLabel("monthly", shiftKey(kind, key, -1));
  return inProgress ? `${baseline.from.slice(0, 4)} to ${dayNoYear.format(at(baseline.to))}` : baseline.from.slice(0, 4);
}

/** ISO dates in prose written before dates were formatted ("2026-10-22"), as people write them. */
export const humanDatesIn = (text: string): string => text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match) => (Number.isNaN(Date.parse(match)) ? match : humanDay(match)));
