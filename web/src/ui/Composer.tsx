import { useEffect, useRef, type ReactNode } from "react";

/** A growing text box with a submit button. Enter sends; Shift+Enter adds a line. */
export function Composer({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  action,
  disabled = false,
  autoFocus = false,
  rows = 2,
  maxLength = 2000,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder?: string;
  action: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  rows?: number;
  maxLength?: number;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [value]);
  const ready = value.trim().length > 0 && !disabled;
  return (
    <form
      className="flex flex-col gap-2 rounded-xl bg-component-strong p-3 shadow-default focus-within:ring-1 focus-within:ring-(--fg-primary)"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit();
      }}
    >
      <label className="sr-only" htmlFor={label}>
        {label}
      </label>
      <textarea
        id={label}
        ref={ref}
        rows={rows}
        value={value}
        maxLength={maxLength}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (ready) onSubmit();
          }
        }}
        className="w-full resize-none bg-transparent px-1 text-body-base outline-none placeholder:text-tertiary disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">{children}</div>
        <button type="submit" className="btn btn-primary shrink-0" disabled={!ready}>
          {action}
        </button>
      </div>
    </form>
  );
}
