import { useState } from "react";
import { IconButton } from "./Button";
import { cx } from "./cx";
import { CheckIcon, CopyIcon } from "./icons";

/** A value to paste somewhere else (a redirect URI, an endpoint URL). Read-only, selectable, one copy button. */
export function CopyField({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn("Clipboard unavailable", error);
    }
  };
  return (
    <div className={cx("flex h-(--control-h) min-w-0 items-center gap-1 rounded-md bg-sunken pr-0.5 pl-2.5", className)}>
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="h-full min-w-0 flex-1 truncate bg-transparent text-body-sm text-primary outline-none"
      />
      <IconButton icon={copied ? CheckIcon : CopyIcon} label={copied ? "Copied" : `Copy ${label.toLowerCase()}`} size="sm" onClick={() => void copy()} />
    </div>
  );
}
