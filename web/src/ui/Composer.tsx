import { useEffect, useRef, type ReactNode } from "react";
import { IconButton } from "./Button";
import { ArrowUpIcon } from "./icons";

/**
 * The assistant input card: a growing text box, a footer row for context (budget, model) and one round send.
 * Enter sends, Shift+Enter adds a line. While a run is going, the send turns into Stop.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  running = false,
  label,
  placeholder,
  disabled = false,
  footer,
  notice,
  maxLength = 2000,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  running?: boolean;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  footer?: ReactNode;
  notice?: ReactNode;
  maxLength?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [value]);
  const ready = value.trim().length > 0 && !disabled && !running;
  return (
    <form
      className="flex flex-col overflow-hidden rounded-xl bg-fill-raised shadow-control has-[textarea:focus-visible]:shadow-[0_0_0_1.5px_var(--focus-ring)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit();
      }}
    >
      {notice && <div className="bg-fill px-3 py-2 text-caption text-secondary">{notice}</div>}
      <textarea
        ref={ref}
        rows={2}
        value={value}
        aria-label={label}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (ready) onSubmit();
          }
        }}
        className="w-full resize-none bg-transparent px-3 pt-3 text-body outline-none placeholder:text-tertiary disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-3 px-2 pb-2">
        <div className="min-w-0 pl-1 text-caption text-secondary">{footer}</div>
        {running && onStop ? (
          <button type="button" onClick={onStop} aria-label="Stop" className="touch-target flex size-8 items-center justify-center rounded-full bg-fill-inverted">
            <span className="size-2.5 rounded-xs bg-page" />
          </button>
        ) : (
          <IconButton type="submit" icon={ArrowUpIcon} label="Send" variant="primary" size="sm" disabled={!ready} className="rounded-full" />
        )}
      </div>
    </form>
  );
}
