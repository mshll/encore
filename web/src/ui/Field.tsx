import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconGlyph } from "./Icon";

/** A text well. Label it with Field, or pass `aria-label` when the context names it (a search box). */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: IconGlyph; end?: ReactNode; invalid?: boolean }>(
  function Input({ icon, end, invalid, className, ...props }, ref) {
    return (
      <span
        className={cx(
          "flex h-(--control-h) min-w-0 items-center gap-2 rounded-md bg-fill px-2.5 text-primary transition-[background-color,box-shadow] duration-150 ease-out",
          "hover:bg-fill-hover has-[input:focus-visible]:bg-fill-hover has-[input:focus-visible]:shadow-[0_0_0_1.5px_var(--focus-ring)]",
          invalid && "shadow-[0_0_0_1px_var(--danger)]",
          className,
        )}
      >
        {icon && <Icon icon={icon} className="text-tertiary" />}
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-body-sm outline-none placeholder:text-tertiary [&::-webkit-search-cancel-button]:hidden"
          {...props}
        />
        {end}
      </span>
    );
  },
);

/** Label, control, then either a hint or an error under it. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm font-medium text-primary">
        {label}
      </label>
      <div className="flex flex-col gap-1.5">
        {children({ id, "aria-describedby": hint || error ? noteId : undefined, invalid: Boolean(error) })}
        {error ? (
          <p id={noteId} className="text-caption text-danger">
            {error}
          </p>
        ) : (
          hint && (
            <p id={noteId} className="text-caption text-secondary">
              {hint}
            </p>
          )
        )}
      </div>
    </div>
  );
}
