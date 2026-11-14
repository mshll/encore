import { Select as Base } from "@base-ui/react/select";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { CaretDownIcon, CheckIcon } from "./icons";
import { buttonClass } from "./Button";
import { MENU_ITEM, POPUP } from "./surfaces";

export type SelectOption<T extends string> = { value: T; label: string };

/** A compact choice from a short list. The trigger is a secondary button that names the current value. */
export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  label: string;
  className?: string;
}) {
  return (
    <Base.Root items={options} value={value} onValueChange={(v) => v !== null && onChange(v as T)}>
      <Base.Trigger aria-label={label} className={buttonClass({ variant: "secondary", className: cx("justify-between gap-2", className) })}>
        <Base.Value className="truncate" />
        <Base.Icon className="flex">
          <Icon icon={CaretDownIcon} className="text-tertiary" />
        </Base.Icon>
      </Base.Trigger>
      <Base.Portal>
        <Base.Positioner sideOffset={6} alignItemWithTrigger={false} collisionPadding={8} className="z-50">
          <Base.Popup className={cx(POPUP, "max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1")}>
            <Base.List>
              {options.map((o) => (
                <Base.Item key={o.value} value={o.value} className={cx(MENU_ITEM, "pr-2 data-[selected]:font-medium")}>
                  <Base.ItemText className="min-w-0 flex-1 truncate">{o.label}</Base.ItemText>
                  <Base.ItemIndicator className="flex text-accent-text">
                    <Icon icon={CheckIcon} />
                  </Base.ItemIndicator>
                </Base.Item>
              ))}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
