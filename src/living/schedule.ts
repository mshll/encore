import type { livingPlaylists } from "../db/schema";
import { localTime } from "../plays/localTime";
import { momentOf } from "./engine";
import type { LivingSchedule } from "./rules";

export type LivingRow = typeof livingPlaylists.$inferSelect;

/** A failed refresh is tried again after this long, so a failing call does not repeat every tick. */
export const RETRY_AFTER_MS = 60 * 60_000;

const DAY_MS = 86_400_000;
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const mondayOf = (ts: number, timezone: string) => {
  const t = localTime(ts, timezone);
  return addDays(t.day, 1 - t.weekday);
};

/** The local period a time falls in; null for kinds refreshed when their source changes. */
export function periodOf(schedule: LivingSchedule, ts: number, timezone: string): string | null {
  if (schedule === "daily") return localTime(ts, timezone).day;
  if (schedule === "window") return `${localTime(ts, timezone).day}:${momentOf(ts, timezone).from}`;
  if (schedule === "weekly") return mondayOf(ts, timezone);
  if (schedule === "monthly") return localTime(ts, timezone).day.slice(0, 7);
  if (schedule === "yearly-weekly") return `${localTime(ts, timezone).day.slice(0, 4)}:${mondayOf(ts, timezone)}`;
  return null;
}

/** First local day of the next period after the last check; null for kinds refreshed when their source changes. */
export function nextRefreshDay(schedule: LivingSchedule, checkedAt: number | null, now: number, timezone: string): string | null {
  const from = checkedAt ?? now;
  if (schedule === "daily") return addDays(localTime(from, timezone).day, 1);
  if (schedule === "window") {
    const day = localTime(from, timezone).day;
    return momentOf(from, timezone).to >= 24 ? addDays(day, 1) : day;
  }
  if (schedule === "weekly") return addDays(mondayOf(from, timezone), 7);
  if (schedule === "yearly-weekly") {
    const monday = addDays(mondayOf(from, timezone), 7);
    const newYear = `${Number(localTime(from, timezone).day.slice(0, 4)) + 1}-01-01`;
    return monday < newYear ? monday : newYear;
  }
  if (schedule === "monthly") {
    const [y, m] = localTime(from, timezone).day.split("-").map(Number) as [number, number];
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }
  return null;
}

export function isDue(schedule: LivingSchedule, row: LivingRow, now: number, timezone: string): boolean {
  if (!row.enabled || row.frozen || row.removedAt !== null) return false;
  if (row.status === "failed" && row.attemptedAt !== null && row.attemptedAt > now - RETRY_AFTER_MS) return false;
  if (row.status === "deferred" || row.playlistId === null || row.checkedAt === null) return true;
  const period = periodOf(schedule, now, timezone);
  return period === null || period !== periodOf(schedule, row.checkedAt, timezone);
}
