import { cx } from "./cx";

/**
 * A figure that rolls up into place when its value changes (a new range, a new filter): the text remounts
 * and plays `digit-in`. Reduced motion makes it instant through the global rule in app.css.
 */
export function AnimatedNumber({ value, className }: { value: string; className?: string }) {
  return (
    <span className={cx("inline-block overflow-clip tabular", className)}>
      <span key={value} className="inline-block animate-[digit-in_var(--dur-move)_var(--ease-out)]">
        {value}
      </span>
    </span>
  );
}
