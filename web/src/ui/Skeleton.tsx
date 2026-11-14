import type { CSSProperties } from "react";
import { cx } from "./cx";

/** A placeholder block. Only where the final layout is known; otherwise use inline status text. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cx("animate-[skeleton-pulse_1.6s_ease-in-out_infinite] rounded-xs bg-fill", className)} style={style} />;
}
