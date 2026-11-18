import { useEffect, useState } from "react";
import { IconButton } from "./Button";
import { cx } from "./cx";
import { Input } from "./Field";
import { MagnifyingGlassIcon, XIcon } from "./icons";

/** A search box that reports its text after a short pause in typing, so each keystroke does not refetch. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  fill = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  /** Takes its container's full width at every size (inside a dialog). */
  fill?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => text !== value && onChange(text), 250);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <Input
      type="search"
      icon={MagnifyingGlassIcon}
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder={placeholder}
      enterKeyHint="search"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      className={cx(fill ? "w-full" : "w-full md:w-72", className)}
      end={text ? <IconButton icon={XIcon} label="Clear search" size="sm" onClick={() => setText("")} /> : undefined}
    />
  );
}
