import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode };

/** Two to four mutually exclusive views of the same data. A filled pill slides to the chosen option. Full width on a phone. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  className?: string;
}) {
  return (
    <Tabs activation="manual" value={value} onValueChange={(v) => onChange(v as T)} className={cx("phone:w-full", className)}>
      <TabsList aria-label={label} className="relative flex items-center rounded-md bg-fill p-0.5">
        {options.map((o) => (
          <TabsTab
            key={o.value}
            value={o.value}
            className="relative z-10 flex h-(--control-h-sm) flex-1 items-center justify-center rounded-sm px-2.5 text-body-sm font-medium whitespace-nowrap text-secondary transition-colors duration-150 hover:text-primary data-[selected]:text-primary"
          >
            {o.label}
          </TabsTab>
        ))}
        <TabsIndicator className="absolute top-(--active-tab-top) left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) rounded-sm bg-fill-raised shadow-control transition-[translate,width] duration-200 ease-out motion-reduce:transition-none" />
      </TabsList>
    </Tabs>
  );
}

/** Underlined tabs over in-page panels. For tabs that change the URL, use TabNav. */
export function TabList<T extends string>({ options, label, className }: { options: SegmentedOption<T>[]; label: string; className?: string }) {
  return (
    <TabsList aria-label={label} className={cx("relative flex items-center gap-5 overflow-x-auto overscroll-x-contain no-scrollbar", className)}>
      {options.map((o) => (
        <TabsTab
          key={o.value}
          value={o.value}
          className="flex h-(--control-h) items-center gap-1.5 text-body-sm font-medium whitespace-nowrap text-secondary transition-colors duration-150 hover:text-primary data-[selected]:text-primary"
        >
          {o.label}
        </TabsTab>
      ))}
      <TabsIndicator className="absolute bottom-0 left-0 h-0.5 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-full bg-fill-inverted transition-[translate,width] duration-200 ease-out motion-reduce:transition-none" />
    </TabsList>
  );
}

export function TabsRoot(props: ComponentProps<typeof Tabs>) {
  return <Tabs activation="manual" {...props} />;
}

export const TabPanel = TabsPanel;
