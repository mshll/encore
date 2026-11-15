import { Switch as Root, SwitchThumb } from "@ui-sdk/react/switch";

/** On/off for a setting that applies at once. Pair it with a visible label. */
export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="group relative flex h-6 w-8 shrink-0 items-center data-[disabled]:opacity-50 phone:h-11 phone:w-[51px]"
    >
      <span aria-hidden className="absolute inset-x-0 top-1/2 h-5 -translate-y-1/2 rounded-full bg-fill-active transition-colors duration-150 ease-out group-data-[checked]:bg-accent phone:h-[31px]" />
      <SwitchThumb className="absolute top-1/2 left-0.5 size-4 -translate-y-1/2 rounded-full bg-white shadow-control transition-transform duration-200 ease-out data-[checked]:translate-x-3 phone:size-[27px] phone:data-[checked]:translate-x-5 motion-reduce:transition-none" />
    </Root>
  );
}
