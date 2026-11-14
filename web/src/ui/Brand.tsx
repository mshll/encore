import { cx } from "./cx";

const MARK_PATH =
  "M7 0h2v1h-2zM4 1h2v1h-2zM7 1h5v1h-5zM3 2h2v1h-2zM6 2h1v1h-1zM8 2h1v1h-1zM10 2h3v1h-3zM2 3h2v1h-2zM5 3h1v1h-1zM11 3h1v1h-1zM13 3h1v1h-1zM1 4h2v1h-2zM4 4h1v1h-1zM6 4h1v1h-1zM8 4h1v1h-1zM10 4h1v1h-1zM12 4h3v1h-3zM1 5h1v1h-1zM3 5h1v1h-1zM13 5h2v1h-2zM1 6h2v1h-2zM6 6h4v1h-4zM12 6h1v1h-1zM14 6h1v1h-1zM0 7h2v1h-2zM6 7h1v1h-1zM9 7h1v1h-1zM13 7h1v1h-1zM15 7h1v1h-1zM0 8h3v1h-3zM4 8h1v1h-1zM6 8h1v1h-1zM9 8h1v1h-1zM12 8h4v1h-4zM1 9h1v1h-1zM3 9h1v1h-1zM6 9h4v1h-4zM13 9h1v1h-1zM1 10h2v1h-2zM4 10h1v1h-1zM10 10h1v1h-1zM12 10h1v1h-1zM14 10h1v1h-1zM1 11h3v1h-3zM11 11h1v1h-1zM13 11h2v1h-2zM2 12h3v1h-3zM6 12h1v1h-1zM8 12h1v1h-1zM10 12h1v1h-1zM12 12h2v1h-2zM3 13h3v1h-3zM7 13h1v1h-1zM9 13h1v1h-1zM11 13h2v1h-2zM4 14h8v1h-8zM7 15h2v1h-2z";

/**
 * The dithered record, in the accent green: Spotify green on dark, the deeper accent text green on light, where Spotify green
 * is under 2:1 against the shell. Drawn on a 16 px grid: use 16, 32 or 48 only so every pixel lands on a device pixel.
 */
export function EncoreMark({ size = 16, className }: { size?: 16 | 32 | 48; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden className={cx("shrink-0 text-accent-text", className)}>
      <path d={MARK_PATH} fill="currentColor" />
    </svg>
  );
}

/**
 * Mark and wordmark, optically centred: the wordmark's box is trimmed to its x-height band ("encore" has no ascenders
 * or descenders, so that band is all of its ink), and the row centres that band on the mark's centre.
 */
export function Lockup({ size = 16 }: { size?: 16 | 32 }) {
  return (
    <span className={cx("flex items-center text-primary", size === 32 ? "gap-3" : "gap-2")}>
      <EncoreMark size={size} />
      <span className={cx("font-display [text-box:trim-both_ex_alphabetic]", size === 32 ? "text-title" : "text-wordmark")}>encore</span>
    </span>
  );
}
