import type { ReactNode } from "react";
import { useStatus } from "../api/queries";
import type { ContextDimension, SkipProfile } from "../api/types";
import { contextLabel, DIMENSION_LABELS, fmtInt, fmtPct } from "../lib/format";
import { RateMeter } from "./RateMeter";

const DIMENSIONS: ContextDimension[] = ["hourBucket", "shuffle", "startMode", "dayType", "device"];

export type ContextRate = { dimension: ContextDimension; value: string; plays: number; skipRate: number };

/** Context values with at least `minPlays` plays and a known skip rate, in display order. */
export function contextRates(profile: SkipProfile, minPlays: number): ContextRate[] {
  return DIMENSIONS.flatMap((dimension) =>
    profile[dimension].flatMap((v) => (v.skipRate !== null && v.plays >= minPlays ? [{ dimension, value: v.value, plays: v.plays, skipRate: v.skipRate }] : [])),
  );
}

/** Skip rate per context, grouped by dimension, each on a 0 to 100% track with the overall rate marked. */
export function ContextRates({ rates, overall }: { rates: ContextRate[]; overall: number | null }): ReactNode {
  const weekendDays = useStatus().data?.weekendDays;
  return (
    <div className="grid gap-x-12 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
      {DIMENSIONS.map((d) => {
        const values = rates.filter((c) => c.dimension === d);
        if (values.length === 0) return null;
        return (
          <div key={d} className="flex min-w-0 flex-col gap-1">
            <h3 className="font-medium text-secondary">{DIMENSION_LABELS[d]}</h3>
            <ul className="flex flex-col">
              {values.map((v) => (
                <li key={v.value} className="grid h-(--row-h-compact) grid-cols-[minmax(0,1fr)_minmax(0,5rem)_2.75rem] items-center gap-3">
                  <span className="truncate" title={`${fmtInt(v.plays)} plays`}>
                    {contextLabel(d, v.value, weekendDays)}
                  </span>
                  <RateMeter rate={v.skipRate} mark={overall} />
                  <span className="text-right text-secondary tabular">{fmtPct(v.skipRate)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
