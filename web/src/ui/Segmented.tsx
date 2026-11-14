import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";

type Option<T extends string> = { value: T; label: ReactNode };

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  label: string;
  className?: string;
}) {
  return (
    <Tabs.Root value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      <Tabs.List
        aria-label={label}
        className="relative flex max-w-full items-center overflow-x-auto rounded-lg bg-component text-body-base font-medium [scrollbar-width:none] md:inline-flex md:rounded-md md:text-body-sm"
      >
        {options.map((o) => (
          <Tabs.Tab
            key={o.value}
            value={o.value}
            className="relative z-10 inline-flex h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-secondary transition-colors duration-200 ease-in-out select-none hover-fine:text-primary data-active:text-primary md:h-7 md:flex-none md:rounded-md md:px-2.5"
          >
            {o.label}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator className="pointer-events-none absolute top-0 left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top) transition-[translate,width] duration-200 ease-out after:absolute after:inset-0 after:rounded-lg after:border after:border-(--segment-border) after:bg-component-strong after:content-[''] md:after:rounded-md" />
      </Tabs.List>
    </Tabs.Root>
  );
}
