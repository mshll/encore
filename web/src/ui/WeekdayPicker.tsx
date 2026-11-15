import { Toggle, ToggleGroup } from "@ui-sdk/react/toggle";
import { WEEKDAYS, WEEKDAYS_SHORT } from "../lib/format";
import { cx } from "./cx";

/** Pick any set of ISO weekdays (1 = Monday). Each day is a toggle; the set comes back sorted. */
export function WeekdayPicker({
  value,
  onChange,
  label,
  id,
  disabled,
  "aria-describedby": describedBy,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  label: string;
  id?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}) {
  return (
    <ToggleGroup
      id={id}
      multiple
      disabled={disabled}
      aria-label={label}
      aria-describedby={describedBy}
      value={value.map(String)}
      onValueChange={(next) => onChange(next.map(Number).sort((a, b) => a - b))}
      className="flex w-full max-w-sm gap-1 data-[disabled]:opacity-50"
    >
      {WEEKDAYS_SHORT.map((short, i) => (
        <Toggle
          key={short}
          value={String(i + 1)}
          aria-label={WEEKDAYS[i]}
          className={cx(
            "press flex h-(--control-h) min-w-0 flex-1 items-center justify-center rounded-md bg-fill text-body-sm font-medium text-secondary transition-colors duration-150 ease-out",
            "hover:bg-fill-hover hover:text-primary data-[pressed]:bg-fill-inverted data-[pressed]:text-inverted",
          )}
        >
          {short}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
