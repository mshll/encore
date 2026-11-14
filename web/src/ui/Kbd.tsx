import { cx } from "./cx";

export const MOD_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** A key cap. Hidden on touch screens, where there is no keyboard to press it on. */
export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs bg-fill px-1 font-sans text-label font-medium text-secondary pointer-coarse:hidden",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
