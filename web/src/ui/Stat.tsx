import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { AnimatedNumber } from "./AnimatedNumber";
import { cx } from "./cx";

export type StatItem<T extends string> = {
  id: T;
  label: string;
  /** Formatted figure, e.g. "1,445". */
  value: string;
  unit?: string;
  /** Signed change against the compared period, as a fraction (0.12 = 12% more). Null hides it. */
  delta?: number | null;
  /** The compared period's figure, shown muted under the main one. */
  compare?: string;
};

const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** Neutral by design: more or less listening is not good or bad, so the change carries no status colour. */
export function Delta({ value }: { value: number }) {
  const rounded = Math.round(value * 100);
  if (rounded === 0) return <span className="text-caption text-tertiary">no change</span>;
  return (
    <span className="text-caption text-secondary tabular">
      {rounded > 0 ? "↑" : "↓"} {pct.format(Math.abs(rounded))}%
    </span>
  );
}

function Figure({ item }: { item: StatItem<string> }) {
  return (
    <>
      <span className="text-caption font-medium text-secondary">{item.label}</span>
      <span className="flex items-baseline gap-1.5">
        <AnimatedNumber value={item.value} className="font-serif text-figure text-primary" />
        {item.unit && <span className="text-body-sm leading-none text-secondary">{item.unit}</span>}
      </span>
      {(item.delta != null || item.compare) && (
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          {item.delta != null && <Delta value={item.delta} />}
          {item.compare && <span className="truncate text-caption text-tertiary tabular">{item.compare}</span>}
        </span>
      )}
    </>
  );
}

/** A figure on its own: label, number, one line of context. */
export function Stat({ item, className }: { item: StatItem<string>; className?: string }) {
  return <div className={cx("flex min-w-0 flex-col gap-0.5", className)}>{<Figure item={item} />}</div>;
}

/**
 * One row of figures that drives one chart: choosing a figure swaps the chart under it.
 * Pass the chart as `children`; it renders once, for the selected figure.
 */
export function StatStrip<T extends string>({
  items,
  value,
  onChange,
  label,
  children,
}: {
  items: StatItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <Tabs.Root value={value} onValueChange={(v) => onChange(v as T)} className="flex flex-col gap-4">
      <Tabs.List aria-label={label} className="relative grid grid-cols-3 gap-x-2 md:flex md:gap-x-10">
        {items.map((item) => (
          <Tabs.Tab
            key={item.id}
            value={item.id}
            className="group flex min-w-0 flex-col items-start gap-0.5 pb-3 text-left outline-offset-4 [&>span:first-child]:transition-colors data-[active]:[&>span:first-child]:text-primary hover:[&>span:first-child]:text-primary"
          >
            <Figure item={item} />
          </Tabs.Tab>
        ))}
        <Tabs.Indicator className="absolute bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-full bg-chart-key transition-[translate,width] duration-300 ease-out motion-reduce:transition-none" />
      </Tabs.List>
      <Tabs.Panel value={value} keepMounted={false}>
        {children}
      </Tabs.Panel>
    </Tabs.Root>
  );
}
