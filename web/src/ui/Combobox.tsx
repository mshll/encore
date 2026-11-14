import { Combobox as Base } from "@base-ui/react/combobox";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { CaretDownIcon, CheckIcon } from "./icons";
import { MENU_ITEM, POPUP } from "./surfaces";

export type ComboboxOption = { value: string; label: string; detail?: string };

/** A choice from a long list (time zones): type to filter, arrows to move, Enter to pick. */
export function Combobox({
  value,
  onChange,
  options,
  id,
  invalid,
  placeholder,
  emptyText = "No matches",
  "aria-describedby": describedBy,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  emptyText?: string;
  "aria-describedby"?: string;
}) {
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <Base.Root
      items={options}
      value={selected}
      onValueChange={(next) => next && onChange(next.value)}
      itemToStringLabel={(o) => o.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
    >
      <div
        className={cx(
          "flex h-(--control-h) min-w-0 items-center rounded-md bg-fill pr-1 pl-2.5 text-primary transition-[background-color,box-shadow] duration-150 ease-out",
          "hover:bg-fill-hover has-[input:focus-visible]:bg-fill-hover has-[input:focus-visible]:shadow-[0_0_0_1.5px_var(--focus-ring)]",
          invalid && "shadow-[0_0_0_1px_var(--danger)]",
        )}
      >
        <Base.Input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-body-sm outline-none placeholder:text-tertiary"
        />
        <Base.Trigger aria-label="Show options" className="touch-target grid size-(--control-h-sm) shrink-0 place-items-center rounded-sm text-tertiary hover:text-primary">
          <Icon icon={CaretDownIcon} />
        </Base.Trigger>
      </div>
      <Base.Portal>
        <Base.Positioner sideOffset={6} align="start" collisionPadding={8} className="z-50">
          <Base.Popup className={cx(POPUP, "max-h-[min(var(--available-height),320px)] w-(--anchor-width) min-w-64 overflow-y-auto p-1")}>
            <Base.Empty className="px-2.5 py-2 text-secondary empty:hidden">{emptyText}</Base.Empty>
            <Base.List>
              {(o: ComboboxOption) => (
                <Base.Item key={o.value} value={o} className={cx(MENU_ITEM, "pr-2 data-[selected]:font-medium")}>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.detail && <span className="shrink-0 text-caption text-tertiary tabular">{o.detail}</span>}
                  <Base.ItemIndicator className="flex text-accent-text">
                    <Icon icon={CheckIcon} />
                  </Base.ItemIndicator>
                </Base.Item>
              )}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
