import type { ReactNode } from "react";
import { Artwork, type ArtKind } from "../ui/Artwork";
import { cx } from "../ui/cx";
import { ditherTile, TILE_STYLE } from "./ditherTile";

/*
  Charts the size of a word, to sit inside a sentence next to the figure they draw. Each one carries its own
  text for assistive tech (`label`), so a screen reader hears the comparison, not a picture.
*/

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const pct = (v: number) => `${clamp01(v) * 100}%`;
const fill = (level = 13) => ({ ...TILE_STYLE, backgroundImage: ditherTile(level) });

/** Two bars, this period over the one before, on one scale: the dithered bar is now, the grey one before. */
export function InlinePair({ now, before, label, className }: { now: number; before: number; label: string; className?: string }) {
  const max = Math.max(now, before) || 1;
  return (
    <span role="img" aria-label={label} className={cx("inline-flex w-12 shrink-0 flex-col justify-center gap-0.5 align-middle", className)}>
      <span className="block h-1.5 rounded-[1px]" style={{ ...fill(), width: pct(now / max), minWidth: now > 0 ? 2 : 0 }} />
      <span className="block h-1 rounded-[1px] bg-chart-axis" style={{ width: pct(before / max), minWidth: before > 0 ? 2 : 0 }} />
    </span>
  );
}

/** The change from `before` to `now` as an arrow and a percentage. Neutral ink: more listening is not good or bad. */
export function InlineChange({ now, before, className }: { now: number; before: number; className?: string }) {
  if (before <= 0) return <span className={cx("text-secondary", className)}>new</span>;
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return <span className={cx("text-secondary", className)}>no change</span>;
  return (
    <span role="img" aria-label={`${Math.abs(change)}% ${change > 0 ? "more" : "less"}`} className={cx("whitespace-nowrap text-secondary tabular", className)}>
      {change > 0 ? "↑" : "↓"} {Math.abs(change)}%
    </span>
  );
}

/**
 * A row of thin dithered columns, one per value, scaled to the largest. `mark` lifts one column to full
 * strength (the busiest day or hour). Long series are summed into at most `bars` columns.
 */
export function InlineColumns({ values, mark, label, bars = 32, className }: { values: number[]; mark?: number | null; label: string; bars?: number; className?: string }) {
  const step = Math.max(1, Math.ceil(values.length / bars));
  const cols = Array.from({ length: Math.ceil(values.length / step) }, (_, i) => values.slice(i * step, (i + 1) * step).reduce((a, b) => a + b, 0));
  const markCol = mark == null ? -1 : Math.floor(mark / step);
  const max = Math.max(...cols, 0) || 1;
  return (
    <span role="img" aria-label={label} className={cx("inline-flex h-5 shrink-0 items-end gap-px align-middle", className)}>
      {cols.map((v, i) => (
        <span
          key={i}
          className={cx("block rounded-t-[1px]", cols.length > 32 ? "w-0.5" : "w-1", v === 0 && "bg-chart-empty")}
          style={v === 0 ? { height: 2 } : { ...fill(i === markCol ? 16 : 11), height: `${Math.max(15, (v / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** A share of the whole (0 to 1) on a short track, with a tick where it stood before. */
export function InlineShare({ share, before, label, className }: { share: number; before?: number | null; label: string; className?: string }) {
  return (
    <span role="img" aria-label={label} className={cx("relative inline-block h-1.5 w-16 shrink-0 rounded-[1px] bg-chart-empty align-middle", className)}>
      <span className="absolute inset-y-0 left-0 rounded-l-[1px]" style={{ ...fill(), width: pct(share), minWidth: share > 0 ? 2 : 0 }} />
      {before != null && <span className="absolute -inset-y-0.5 w-px bg-primary" style={{ left: pct(before) }} />}
    </span>
  );
}

/** Artwork beside a name, sized to a line of text. The name is the link label; the image is decoration. */
export function ArtChip({ src, kind, children, className }: { src: string | null | undefined; kind: ArtKind; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex max-w-full min-w-0 items-center gap-1.5 align-bottom", className)}>
      <Artwork src={src} kind={kind} box={20} />
      <span className="line-clamp-1 min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </span>
  );
}

/**
 * One fact on a line: what it is, its small chart, the figure, then what it names ("Busiest day ▂▅█▃ 2.6 h Sunday
 * 6 September"). The words carry the fact for assistive tech; the chart's own label says what it draws.
 */
export function InlineFact({ label, mark, figure, children, className }: { label: string; mark?: ReactNode; figure: string; children: ReactNode; className?: string }) {
  return (
    <p className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-primary", className)}>
      <span className="text-secondary">{label}</span>
      {mark}
      <span className="font-medium whitespace-nowrap tabular">{figure}</span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
