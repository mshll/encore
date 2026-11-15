import { Checkbox as Root, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { CheckIcon, MinusIcon } from "./icons";

/**
 * Selects a row for a batch action. `indeterminate` marks a partly selected group (select all).
 * The hit area is 24px on desktop and 44px on a phone; the drawn box stays small inside it.
 */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  id,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  id?: string;
  className?: string;
}) {
  return (
    <Root
      id={id}
      checked={indeterminate ? "indeterminate" : checked}
      onCheckedChange={(next) => onChange(next === true)}
      aria-label={label}
      className={cx("group grid size-6 shrink-0 place-items-center rounded-sm outline-none phone:-m-2.5 phone:size-11", className)}
    >
      <span
        className={cx(
          "grid size-[18px] place-items-center rounded-xs bg-fill-raised text-on-accent shadow-control transition-colors duration-150 ease-out phone:size-5",
          "group-data-[checked]:bg-accent group-data-[indeterminate]:bg-accent group-focus-visible:shadow-[0_0_0_1.5px_var(--focus-ring)]",
        )}
      >
        <CheckboxIndicator className="flex">
          <Icon icon={indeterminate ? MinusIcon : CheckIcon} />
        </CheckboxIndicator>
      </span>
    </Root>
  );
}
