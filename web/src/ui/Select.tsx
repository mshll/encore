import { Select as Root, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger, SelectValue } from "@ui-sdk/react/select";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { CaretDownIcon, CheckIcon } from "./icons";
import { buttonClass } from "./Button";
import { LAYER, MENU_ITEM, POPUP } from "./surfaces";

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
    <Root items={options} value={value} onValueChange={(v) => v !== null && onChange(v as T)}>
      <SelectTrigger aria-label={label} className={buttonClass({ variant: "secondary", className: cx("justify-between gap-2", className) })}>
        <SelectValue className="min-w-0 flex-1 truncate text-left" />
        <span aria-hidden className="flex">
          <Icon icon={CaretDownIcon} className="text-tertiary" />
        </span>
      </SelectTrigger>
      <SelectContent
        container={LAYER}
        sideOffset={6}
        align="center"
        alignItemWithTrigger={false}
        collisionPadding={8}
        className={cx(POPUP, "max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1")}
      >
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} label={o.label} className={cx(MENU_ITEM, "pr-2 data-[selected]:font-medium")}>
            <SelectItemText className="min-w-0 flex-1 truncate">{o.label}</SelectItemText>
            <SelectItemIndicator className="flex text-accent-text">
              <Icon icon={CheckIcon} />
            </SelectItemIndicator>
          </SelectItem>
        ))}
      </SelectContent>
    </Root>
  );
}
