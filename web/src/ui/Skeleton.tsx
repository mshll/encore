import type { CSSProperties } from "react";
import { cx } from "./cx";

/** A placeholder block. Only where the final layout is known; otherwise use inline status text. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  // cx does not merge Tailwind classes, so the default radius steps aside when the caller sets one.
  const radius = !className?.includes("rounded-") && "rounded-xs";
  return <div aria-hidden className={cx("animate-[skeleton-pulse_1.6s_ease-in-out_infinite] bg-fill", radius, className)} style={style} />;
}

const BARS = [38, 52, 46, 61, 74, 58, 49, 67, 82, 63, 47, 40, 55, 71, 60, 45];

/**
 * A chart or heatmap that is still loading, in the chart's own box: thin bars rising from the baseline, or the
 * rows of a grid. Never one filled slab, which reads as a card set inside the page.
 */
export function ChartSkeleton({ shape = "bars", phoneRows = 7, className }: { shape?: "bars" | "grid"; phoneRows?: number; className?: string }) {
  // A grid has 7 rows (weekdays) from md; on a phone a heatmap turns on its side and has `phoneRows` thin rows.
  if (shape === "grid")
    return (
      <div aria-hidden className={cx("flex flex-col gap-1", className)}>
        {Array.from({ length: Math.max(7, phoneRows) }, (_, i) => (
          <Skeleton key={i} className={cx("min-h-2 flex-1", i >= phoneRows && "phone:hidden", i >= 7 && "md:hidden")} />
        ))}
      </div>
    );
  return (
    <div aria-hidden className={cx("flex items-end gap-1", className)}>
      {BARS.map((h, i) => (
        <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
