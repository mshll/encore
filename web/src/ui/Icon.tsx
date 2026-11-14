import type { Icon as PhosphorIcon } from "@phosphor-icons/react/dist/lib/types";
import { cx } from "./cx";

export type IconGlyph = PhosphorIcon;

const SIZES = { sm: 16, md: 20, lg: 24, fill: "100%" } as const;
export type IconSize = keyof typeof SIZES;

/** `fill` draws the glyph at the size the caller's className gives the box (artwork placeholders). */
const BOX: Record<IconSize, string> = { sm: "size-4", md: "size-5", lg: "size-6", fill: "" };

/**
 * The only way to draw an icon. `fill` is for the active nav item and the playing state.
 * The glyph sits in its own even box, so centering it never lands on a half pixel while a button scales.
 */
export function Icon({ icon: Glyph, size = "sm", fill = false, className }: { icon: IconGlyph; size?: IconSize; fill?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cx("inline-grid shrink-0 place-items-center", BOX[size], className)}>
      <Glyph size={SIZES[size]} weight={fill ? "fill" : "regular"} focusable={false} />
    </span>
  );
}
