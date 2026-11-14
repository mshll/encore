import type { CSSProperties } from "react";
import { cx } from "./cx";

/** A placeholder block. Only where the final layout is known; otherwise use inline status text. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cx("animate-[skeleton-pulse_1.6s_ease-in-out_infinite] rounded-xs bg-fill", className)} style={style} />;
}

const BARS = [38, 52, 46, 61, 74, 58, 49, 67, 82, 63, 47, 40, 55, 71, 60, 45];

/**
 * A chart or heatmap that is still loading, in the chart's own box: thin bars rising from the baseline, or the
 * rows of a grid. Never one filled slab, which reads as a card set inside the page.
 */
export function ChartSkeleton({ shape = "bars", className }: { shape?: "bars" | "grid"; className?: string }) {
  if (shape === "grid")
    return (
      <div aria-hidden className={cx("flex flex-col gap-1", className)}>
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="min-h-2 flex-1" />
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
