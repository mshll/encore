import type { Period } from "../api/types";
import { fmtDay, fmtDayShort, fmtMonth, fmtMonthShort } from "../lib/format";

export function periodTick(period: string, kind: Period) {
  if (kind === "year") return period;
  if (kind === "month") return `${fmtMonthShort(period)} ${period.slice(2, 4)}`;
  return fmtDayShort(period);
}

export function periodTitle(period: string, kind: Period) {
  if (kind === "year") return period;
  if (kind === "month") return fmtMonth(period);
  if (kind === "week") return `Week of ${fmtDay(period)}`;
  return fmtDay(period);
}
