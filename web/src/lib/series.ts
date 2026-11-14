import type { Period } from "../api/types";
import { daySequence, monthSequence, weekSequence, weekStart, yearSequence } from "./dates";
import type { Range } from "./range";

export function fillPeriods<T extends { period: string }>(points: T[], period: Period, range: Range, today: string, empty: (period: string) => T): T[] {
  if (points.length === 0) return [];
  const firstDay = toDay(points[0]!.period);
  const lastDay = toDay(points[points.length - 1]!.period);
  const from = range.from && range.from < firstDay ? range.from : firstDay;
  const capped = range.to && range.to < today ? range.to : today;
  const to = capped > lastDay ? capped : lastDay;
  const keys =
    period === "day"
      ? daySequence(from, to)
      : period === "week"
        ? weekSequence(weekStart(from), to)
        : period === "month"
          ? monthSequence(from.slice(0, 7), to.slice(0, 7))
          : yearSequence(from, to);
  const byKey = new Map(points.map((p) => [p.period, p]));
  return keys.map((k) => byKey.get(k) ?? empty(k));
}

function toDay(period: string): string {
  if (period.length === 4) return `${period}-01-01`;
  if (period.length === 7) return `${period}-01`;
  return period;
}
