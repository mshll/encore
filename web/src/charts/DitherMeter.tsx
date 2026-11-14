import { cx } from "../ui/cx";
import { ditherTile, TILE_STYLE } from "./ditherTile";

/**
 * A ranked bar in the dither texture: length is the share of the largest row, the end is a solid cap.
 * Decorative next to a printed figure, so it is hidden from assistive tech.
 */
export function DitherMeter({ share, className }: { share: number; className?: string }) {
  const width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  return (
    <span aria-hidden className={cx("relative block h-2 overflow-hidden", className ?? "w-full")}>
      <span className="absolute inset-y-0 left-0 flex" style={{ width }}>
        <span className="h-full flex-1" style={{ ...TILE_STYLE, backgroundImage: ditherTile(9) }} />
        <span className="h-full w-0.5 bg-chart-key" />
      </span>
    </span>
  );
}
