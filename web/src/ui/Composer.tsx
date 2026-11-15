import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { ArrowUpIcon, XIcon } from "./icons";
import { Notice } from "./Notice";

/*
 * The prompt bar, after Beautiful UI's Prompt Bar (MIT, see chat/parts/LICENSE): chips over the text (the page the
 * message is about), a growing text box, then one row of controls with the send square at its end. Enter sends,
 * Shift+Enter adds a line. While a run is going, send turns into Stop.
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
  chips,
  maxLength = 2000,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  running?: boolean;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** The control row before send: the job picker, or the month's spend. */
  footer?: ReactNode;
  notice?: ReactNode;
  /** Over the text: what the message is about. */
  chips?: ReactNode;
  maxLength?: number;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? own;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // Hidden (a closed panel kept mounted) it measures 0: leave it at its rows until it is shown and typed in.
    if (el.scrollHeight > 0) el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
  }, [value, ref]);
  const ready = value.trim().length > 0 && !disabled && !running;
  // The hit area grows to 44 on a phone; the square inside keeps its size.
  const hit = "group press flex size-7 shrink-0 items-center justify-center phone:-my-2 phone:-mr-1.5 phone:size-11";
  const square = "flex size-7 items-center justify-center rounded-md transition-colors duration-200";
  return (
    <form
      className="flex flex-col overflow-hidden rounded-xl bg-fill-raised shadow-control has-[textarea:focus-visible]:shadow-[0_0_0_1.5px_var(--focus-ring)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit();
      }}
    >
      {notice && (
        <Notice tone="warning" className="rounded-none phone:mx-0 phone:px-3">
          {notice}
        </Notice>
      )}
      <div className="flex flex-col gap-1.5 p-1.5">
        {chips && <div className="flex min-w-0 flex-wrap gap-1.5 px-0.5 pt-0.5">{chips}</div>}
        <textarea
          ref={ref}
          rows={2}
          value={value}
          aria-label={label}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          enterKeyHint="send"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (ready) onSubmit();
            }
          }}
          className="w-full resize-none bg-transparent px-1.5 pt-1.5 text-body outline-none [overflow-wrap:anywhere] placeholder:text-tertiary disabled:opacity-60"
        />
        <div className="flex min-h-7 items-center gap-1 pt-0.5">
          <div className="flex min-w-0 flex-1 items-center text-caption text-secondary">{footer}</div>
          {running && onStop ? (
            <button type="button" onClick={onStop} aria-label="Stop" className={hit}>
              <span className={cx(square, "bg-fill-inverted group-hover:bg-fill-inverted-hover")}>
                <span className="size-2.5 rounded-xs bg-page" />
              </span>
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send"
              disabled={!ready}
              className={hit}
            >
              <span className={cx(square, ready ? "bg-fill-inverted text-inverted group-hover:bg-fill-inverted-hover" : "bg-fill-active text-tertiary")}>
                <Icon icon={ArrowUpIcon} />
              </span>
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

/** A chip over the prompt: what the message is about, with a way to send it without. */
export function ComposerChip({ label, value, onRemove }: { label: string; value: string; onRemove: () => void }) {
  return (
    <span className="flex h-6 max-w-full min-w-0 items-center gap-1 rounded-sm bg-fill pr-0.5 pl-2 text-caption text-secondary animate-[fade-in_200ms_var(--ease-out)_both]">
      <span className="min-w-0 truncate" title={`${label} ${value}`}>
        {label} <span className="text-primary">{value}</span>
      </span>
      <button
        type="button"
        aria-label={`Remove ${value}`}
        onClick={onRemove}
        className="press flex size-5 shrink-0 items-center justify-center rounded-xs text-tertiary phone:-my-2.5 phone:-mr-6 phone:size-11 phone:justify-start phone:pl-0.5 transition-colors duration-150 hover:bg-fill-hover hover:text-primary"
      >
        <Icon icon={XIcon} />
      </button>
    </span>
  );
}
