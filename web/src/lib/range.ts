import { useCallback, useMemo } from "react";
import { useSearchParams } from "wouter";
import type { Period } from "../api/types";
import { addDays, addMonths, daysBetween } from "./dates";
import { fmtDayRange } from "./format";

export type Range = { from?: string; to?: string };

export type Preset = { id: string; label: string; range: Range };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function presets(today: string, firstYear: number): Preset[] {
  const year = Number(today.slice(0, 4));
  const years: Preset[] = [];
  for (let y = year; y >= firstYear; y--) years.push({ id: String(y), label: String(y), range: { from: `${y}-01-01`, to: `${y}-12-31` } });
  return [
    { id: "all", label: "All time", range: {} },
    { id: "30d", label: "Last 30 days", range: { from: addDays(today, -29), to: today } },
    { id: "90d", label: "Last 90 days", range: { from: addDays(today, -89), to: today } },
    { id: "12m", label: "Last 12 months", range: { from: addDays(addMonths(today, -12), 1), to: today } },
    ...years,
  ];
}

export function rangeLabel(range: Range, list: Preset[]): string {
  const match = list.find((p) => p.range.from === range.from && p.range.to === range.to);
  if (match) return match.label;
  if (range.from && range.to) return fmtDayRange(range.from, range.to);
  if (range.from) return `Since ${fmtDayRange(range.from, range.from)}`;
  if (range.to) return `Until ${fmtDayRange(range.to, range.to)}`;
  return "All time";
}

export function periodFor(range: Range, firstDay: string | null, today: string): Period {
  const from = range.from ?? firstDay ?? today;
  const to = range.to && range.to < today ? range.to : today;
  const days = daysBetween(from, to);
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  return "month";
}

export function useRange() {
  const [params, setParams] = useSearchParams();
  const fromParam = params.get("from");
  const toParam = params.get("to");
  const range = useMemo<Range>(
    () => ({ from: fromParam && DAY.test(fromParam) ? fromParam : undefined, to: toParam && DAY.test(toParam) ? toParam : undefined }),
    [fromParam, toParam],
  );
  const setRange = useCallback(
    (next: Range) =>
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          for (const key of ["from", "to"] as const) {
            const value = next[key];
            if (value) out.set(key, value);
            else out.delete(key);
          }
          return out;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { range, setRange };
}

export function rangeSearch(range: Range): string {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
