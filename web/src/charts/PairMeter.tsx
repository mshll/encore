import { cx } from "../ui/cx";
import { ditherTile, TILE_STYLE } from "./ditherTile";

const width = (v: number, max: number) => `${Math.max(0, Math.min(1, max > 0 ? v / max : 0)) * 100}%`;

/**
 * Now over before as two bars on a shared scale (`max`, the largest value in the list): the dithered bar is now,
 * the grey one before. Decorative next to the printed figures, so it is hidden from assistive tech.
 */
export function PairMeter({ now, before, max, className }: { now: number; before: number; max: number; className?: string }) {
  return (
    <span aria-hidden className={cx("flex flex-col justify-center gap-0.5", className ?? "w-full")}>
      <span className="block h-2 rounded-[1px]" style={{ ...TILE_STYLE, backgroundImage: ditherTile(13), width: width(now, max), minWidth: now > 0 ? 2 : 0 }} />
      <span className="block h-1 rounded-[1px] bg-chart-axis" style={{ width: width(before, max), minWidth: before > 0 ? 2 : 0 }} />
    </span>
  );
}
