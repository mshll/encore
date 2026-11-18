import type { ContextDimension, Device, MomentClass, PlayOutcome } from "../api/types";

const int = new Intl.NumberFormat("en");
const one = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export const fmtInt = (n: number) => int.format(n);
export const fmtCompact = (n: number) => (n < 10_000 ? int.format(n) : compact.format(n));

export function fmtBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${one.format(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${one.format(bytes / 1_000_000)} MB`;
  return `${one.format(bytes / 1_000_000_000)} GB`;
}

export function fmtHours(hours: number): string {
  const minutes = hours * 60;
  if (minutes < 1) return hours > 0 ? "<1 min" : "0 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (hours < 10) return `${one.format(hours)} h`;
  return `${int.format(Math.round(hours))} h`;
}

export const fmtHoursValue = (hours: number) => (hours < 10 ? one.format(hours) : int.format(Math.round(hours)));

export const fmtPct = (rate: number | null | undefined) => (rate == null ? "n/a" : `${Math.round(rate * 100)}%`);

export function fmtDuration(ms: number | null): string {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayNoYearFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const monthLongFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const monthShortFmt = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });

export const fmtDay = (day: string) => dayFmt.format(new Date(`${day}T00:00:00Z`));
export const fmtDayShort = (day: string) => dayNoYearFmt.format(new Date(`${day}T00:00:00Z`));
export const fmtMonth = (month: string) => monthFmt.format(new Date(`${month}-01T00:00:00Z`));
export const fmtMonthLong = (month: string) => monthLongFmt.format(new Date(`${month}-01T00:00:00Z`));
export const fmtMonthShort = (month: string) => monthShortFmt.format(new Date(`${month}-01T00:00:00Z`));

export function fmtPeriod(period: string): string {
  if (period.length === 4) return period;
  if (period.length === 7) return fmtMonth(period);
  return fmtDay(period);
}

export function fmtDayRange(from: string, to: string): string {
  if (from === to) return fmtDay(from);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${fmtDayShort(from)} – ${fmtDay(to)}`;
  return `${fmtDay(from)} – ${fmtDay(to)}`;
}

export function fmtTimestamp(iso: string, timezone: string, withYear = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(iso));
}

export function fmtDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: timezone }).format(new Date(iso));
}

export function fmtTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(iso));
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function fmtAgo(iso: string, now = Date.now()): string {
  const seconds = (Date.parse(iso) - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 60) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 86_400 * 45) return relative.format(Math.round(seconds / 86_400), "day");
  if (abs < 86_400 * 365) return relative.format(Math.round(seconds / (86_400 * 30.4)), "month");
  return relative.format(Math.round(seconds / (86_400 * 365.25)), "year");
}

export const fmtHour = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const regions = new Intl.DisplayNames(["en"], { type: "region" });
export function countryName(code: string): string {
  try {
    return regions.of(code) ?? code;
  } catch (error) {
    if (error instanceof RangeError) return code;
    throw error;
  }
}

export const DEVICE_LABELS: Record<Device, string> = {
  ios: "iPhone",
  android: "Android",
  mac: "Mac",
  windows: "Windows",
  linux: "Linux",
  web: "Web player",
  console: "Console",
  tv: "TV",
  speaker: "Speaker",
  car: "Car",
  unknown: "Unknown device",
  other: "Other device",
};

export const DIMENSION_LABELS: Record<ContextDimension, string> = {
  hourBucket: "Time of day",
  dayType: "Day",
  shuffle: "Shuffle",
  device: "Device",
  startMode: "How it started",
};

const CONTEXT_VALUES: Record<string, string> = {
  night: "Night, 00–06",
  morning: "Morning, 06–12",
  afternoon: "Afternoon, 12–18",
  evening: "Evening, 18–24",
  on: "Shuffle on",
  off: "Shuffle off",
  chosen: "You picked it",
  auto: "Came from the queue",
};

const listDays = (days: number[]) => {
  const names = days.map((d) => WEEKDAYS_SHORT[d - 1]!);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

/**
 * Names the weekend and the rest of the week from the ISO days in `GET /api/status` (`weekendDays`):
 * [5, 6] gives "Fri and Sat" and "Sun to Thu". A run of three or more days in a row reads as a range.
 */
export function weekendLabels(weekendDays: number[]): { weekend: string; weekday: string } {
  const weekend = [...new Set(weekendDays)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  const rest = [1, 2, 3, 4, 5, 6, 7].filter((d) => !weekend.includes(d));
  if (weekend.length === 0) return { weekend: "No weekend", weekday: "Every day" };
  if (rest.length === 0) return { weekend: "Every day", weekday: "No weekdays" };
  const start = rest.find((d) => !rest.includes(d === 1 ? 7 : d - 1)) ?? rest[0]!;
  const run = rest.map((_, i) => ((start - 1 + i) % 7) + 1);
  const contiguous = run.every((d) => rest.includes(d));
  const weekday = contiguous && run.length >= 3 ? `${WEEKDAYS_SHORT[run[0]! - 1]} to ${WEEKDAYS_SHORT[run.at(-1)! - 1]}` : listDays(rest);
  return { weekend: listDays(weekend), weekday };
}

/** `weekendDays` from `GET /api/status`; without it the day type reads "Weekdays" or "Weekend". */
export function contextLabel(dimension: ContextDimension, value: string, weekendDays?: number[]): string {
  if (dimension === "device") return DEVICE_LABELS[value as Device] ?? value;
  if (dimension === "dayType" && (value === "weekday" || value === "weekend")) {
    if (!weekendDays) return value === "weekend" ? "Weekend" : "Weekdays";
    return weekendLabels(weekendDays)[value];
  }
  return CONTEXT_VALUES[value] ?? value;
}

export const OUTCOME_LABELS: Record<PlayOutcome, string> = {
  through: "Played through",
  early: "Skipped early",
  midway: "Skipped midway",
  interrupted: "Interrupted",
};

export const CLASS_LABELS: Record<MomentClass, string> = {
  wrong_moment: "Wrong moment",
  skipped_everywhere: "Skipped everywhere",
  keeper: "Keeper",
  mixed: "Mixed",
};

const CONTEXT_PHRASES: Record<string, string> = {
  night: "at night",
  morning: "in the morning",
  afternoon: "in the afternoon",
  evening: "in the evening",
  weekday: "on weekdays",
  weekend: "on weekends",
  on: "on shuffle",
  off: "with shuffle off",
  chosen: "when you pick it",
  auto: "when it comes from the queue",
};

export function contextPhrase(dimension: ContextDimension, value: string): string {
  if (dimension === "device") return `on ${DEVICE_LABELS[value as Device] ?? value}`;
  return CONTEXT_PHRASES[value] ?? value;
}

export function hoursParts(hours: number): { value: string; unit: string } {
  if (hours * 60 < 60) return { value: fmtInt(Math.round(hours * 60)), unit: Math.round(hours * 60) === 1 ? "minute" : "minutes" };
  return { value: fmtHoursValue(hours), unit: "hours" };
}
