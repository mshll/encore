import { cx } from "../ui/cx";
import { ditherTile, levelFor, TILE_STYLE } from "./ditherTile";

/**
 * Spent against a cap, as one dithered bar on an empty track. Red once the cap is reached.
 * The figure it draws is always printed next to it, so the bar is a meter for assistive tech, not the only source.
 */
export function BudgetBar({ spent, cap, label, className }: { spent: number; cap: number; label: string; className?: string }) {
  const share = cap > 0 ? Math.min(1, spent / cap) : 1;
  const exhausted = cap <= 0 || spent >= cap;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={cap}
      aria-valuenow={Math.min(spent, cap)}
      className={cx("relative h-3 w-full overflow-hidden rounded-xs bg-chart-empty", className)}
    >
      <span className="absolute inset-y-0 left-0 flex" style={{ width: `${Math.max(share * 100, spent > 0 ? 1 : 0)}%` }}>
        <span className="h-full flex-1" style={{ ...TILE_STYLE, backgroundImage: ditherTile(exhausted ? 16 : Math.max(levelFor(share), 9), exhausted ? "red" : "green") }} />
        <span className={cx("h-full w-0.5", exhausted ? "bg-danger" : "bg-chart-key")} />
      </span>
    </div>
  );
}
