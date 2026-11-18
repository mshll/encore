import { cx } from "../ui/cx";
import { ditherTile, TILE_STYLE } from "./ditherTile";

export type WeekBar = { day: string; label: string; hours: number | null; usual: number | null; today: boolean };

const pct = (v: number, max: number) => `${(Math.min(v, max) / max) * 100}%`;

/**
 * The week as seven dithered columns on one scale, each with a tick at the usual for that weekday. A day still to come
 * has its tick and no column. Each day reads as one sentence to assistive tech; the drawing is hidden from it.
 */
export function WeekBars({ days, format, height, className }: { days: WeekBar[]; format: (hours: number) => string; height: number; className?: string }) {
  const max = Math.max(...days.map((d) => Math.max(d.hours ?? 0, d.usual ?? 0)), 0) || 1;
  return (
    <ul aria-label="Hours each day this week, against the usual for that day" className={cx("grid grid-cols-7 gap-1.5 md:gap-2", className)}>
      {days.map((d) => {
        const said = `${d.label}: ${d.hours === null ? "still to come" : format(d.hours)}${d.usual === null ? "" : `, usually ${format(d.usual)}`}`;
        return (
          <li key={d.day} className="flex min-w-0 flex-col gap-1.5">
            <span className="sr-only">{said}</span>
            <div aria-hidden className="relative w-full" style={{ height }}>
              <div className="absolute inset-x-0 bottom-0 h-px bg-chart-axis" />
              {d.hours !== null && d.hours > 0 && (
                <div className="absolute inset-x-0 bottom-0 rounded-t-xs" style={{ ...TILE_STYLE, backgroundImage: ditherTile(d.today ? 16 : 12), height: pct(d.hours, max), minHeight: 2 }} />
              )}
              {d.usual !== null && <div className="absolute -inset-x-0.5 h-0.5 rounded-full bg-primary" style={{ bottom: `calc(${pct(d.usual, max)} - 1px)` }} />}
            </div>
            <div aria-hidden className="flex flex-col items-center leading-tight">
              <span className={cx("text-caption", d.today ? "font-medium text-primary" : "text-secondary")}>{d.label}</span>
              <span className="text-caption text-tertiary tabular">{d.hours === null ? " " : format(d.hours)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
