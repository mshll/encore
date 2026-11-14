import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import { useLifetime, useTimezone } from "../api/queries";
import { todayIn } from "../lib/dates";
import { presets, rangeLabel, useRange, type Range } from "../lib/range";
import { ArrowDown01Icon, Icon, Tick02Icon } from "./Icon";

export function RangePicker() {
  const { range, setRange } = useRange();
  const timezone = useTimezone();
  const lifetime = useLifetime();
  const today = todayIn(timezone);
  const firstYear = Number((lifetime.data?.firstPlayed ?? today).slice(0, 4));
  const list = presets(today, firstYear);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<Range>(range);
  const isSelected = (r: Range) => r.from === range.from && r.to === range.to;
  const choose = (r: Range) => {
    setRange(r);
    setOpen(false);
  };
  const customValid = Boolean(custom.from && custom.to && custom.from <= custom.to);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setCustom(range);
      }}
    >
      <Popover.Trigger className="btn btn-secondary max-w-full" aria-label={`Date range: ${rangeLabel(range, list)}`}>
        <span className="truncate tabular">{rangeLabel(range, list)}</span>
        <Icon icon={ArrowDown01Icon} size={16} className="text-tertiary" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end" className="z-50">
          <Popover.Popup className="popup flex max-h-(--available-height) w-72 flex-col overflow-y-auto p-1 outline-none">
            <div role="listbox" aria-label="Date range presets" className="flex flex-col">
              {list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected(p.range)}
                  className="menu-item w-full justify-between text-left hover-fine:bg-component focus-visible:bg-component"
                  onClick={() => choose(p.range)}
                >
                  <span>{p.label}</span>
                  {isSelected(p.range) && <Icon icon={Tick02Icon} size={16} />}
                </button>
              ))}
            </div>
            <form
              className="mt-1 flex flex-col gap-2 border-t-[0.5px] border-border-strong px-2.5 pt-3 pb-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (customValid) choose(custom);
              }}
            >
              <p className="text-body-sm font-medium text-secondary">Custom range</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-caption-lg text-secondary">
                  From
                  <span className="field">
                    <input
                      type="date"
                      value={custom.from ?? ""}
                      max={custom.to ?? today}
                      onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || undefined }))}
                    />
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-caption-lg text-secondary">
                  To
                  <span className="field">
                    <input
                      type="date"
                      value={custom.to ?? ""}
                      min={custom.from}
                      onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || undefined }))}
                    />
                  </span>
                </label>
              </div>
              <button type="submit" className="btn btn-primary w-full" disabled={!customValid}>
                Apply range
              </button>
            </form>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
