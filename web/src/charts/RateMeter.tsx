import type { ReactNode } from "react";
import { cx } from "../ui/cx";
import { ditherTile, TILE_STYLE } from "./ditherTile";

/**
 * A rate on a fixed 0 to 100% track: the dither fill is the rate, the faint well is the rest, and an optional
 * tick marks a reference rate (an overall average) so rows read against it. Decorative next to a printed figure.
 */
export function RateMeter({ rate, mark, className }: { rate: number; mark?: number | null; className?: string }): ReactNode {
  const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <span aria-hidden className={cx("relative block h-2 rounded-[2px] bg-chart-empty", className ?? "w-full")}>
      <span className="absolute inset-y-0 left-0 flex overflow-hidden rounded-l-[2px]" style={{ width: pct(rate) }}>
        <span className="h-full flex-1" style={{ ...TILE_STYLE, backgroundImage: ditherTile(9) }} />
        <span className="h-full w-0.5 bg-chart-key" />
      </span>
      {mark != null && <span className="absolute -inset-y-1 w-px bg-primary" style={{ left: pct(mark) }} />}
    </span>
  );
}
