import { useState } from "react";
import { useLifetime, useTimezone } from "../api/queries";
import { todayIn } from "../lib/dates";
import { presets, rangeLabel, useRange, type Preset, type Range } from "../lib/range";
import { Button, buttonClass } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { CaretDownIcon, CheckIcon } from "./icons";
import { Input } from "./Field";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "./Popover";
import { MENU_ITEM } from "./surfaces";

function usePresets(): Preset[] {
  const today = todayIn(useTimezone());
  const lifetime = useLifetime();
  return presets(today, Number((lifetime.data?.firstPlayed ?? today).slice(0, 4)));
}

/** The current range's name, as the picker shows it ("All time", "Last 30 days", "2025"). */
export function useRangeLabel(): string {
  const { range } = useRange();
  return rangeLabel(range, usePresets());
}

/** The date scope for a surface. Lives in the URL (`from`, `to`) so links and reloads keep it. */
export function RangePicker({ className }: { className?: string }) {
  const { range, setRange } = useRange();
  const today = todayIn(useTimezone());
  const list = usePresets();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<Range>(range);
  const isSelected = (r: Range) => r.from === range.from && r.to === range.to;
  const choose = (r: Range) => {
    setRange(r);
    setOpen(false);
  };
  const customValid = Boolean(custom.from && custom.to && custom.from <= custom.to);
  const label = rangeLabel(range, list);

  return (
    <PopoverRoot
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setCustom(range);
      }}
    >
      <PopoverTrigger className={buttonClass({ className: cx("justify-between gap-2", className) })} aria-label={`Date range: ${label}`}>
        <span className="truncate tabular">{label}</span>
        <Icon icon={CaretDownIcon} className="text-tertiary" />
      </PopoverTrigger>
      <PopoverPopup className="flex w-72 flex-col p-1">
        <div role="listbox" aria-label="Date range" className="flex flex-col">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={isSelected(p.range)}
              className={cx(MENU_ITEM, "w-full justify-between text-left hover:bg-fill focus-visible:bg-fill aria-selected:font-medium")}
              onClick={() => choose(p.range)}
            >
              <span>{p.label}</span>
              {isSelected(p.range) && <Icon icon={CheckIcon} className="text-accent-text" />}
            </button>
          ))}
        </div>
        <form
          className="mt-1 flex flex-col gap-2 px-1.5 pt-3 pb-1.5 hairline-t"
          onSubmit={(e) => {
            e.preventDefault();
            if (customValid) choose(custom);
          }}
        >
          <p className="text-caption font-medium text-secondary">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              aria-label="From"
              value={custom.from ?? ""}
              max={custom.to ?? today}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || undefined }))}
            />
            <Input type="date" aria-label="To" value={custom.to ?? ""} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || undefined }))} />
          </div>
          <Button type="submit" variant="primary" disabled={!customValid}>
            Apply range
          </Button>
        </form>
      </PopoverPopup>
    </PopoverRoot>
  );
}
