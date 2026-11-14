import { useId, type ReactNode } from "react";
import { cx } from "./cx";

export type SettingControlProps = { id: string; "aria-describedby"?: string; invalid: boolean };

/**
 * One setting: label and an optional short hint on the left, the control on the right (stacked on a phone).
 * `error` replaces the hint while it stands. Rows sit in a `SettingRows` list.
 */
export function SettingRow({
  label,
  hint,
  error,
  children,
  wide = false,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Gives the control the full row under the label (lists, long values). */
  wide?: boolean;
  children: (props: SettingControlProps) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ? (
    <p id={noteId} className="text-caption text-danger text-pretty">
      {error}
    </p>
  ) : (
    hint && (
      <p id={noteId} className="text-caption text-secondary text-pretty">
        {hint}
      </p>
    )
  );
  return (
    <div className={cx("grid gap-x-8 gap-y-2 py-3", !wide && "md:grid-cols-[minmax(0,1fr)_minmax(0,320px)] md:items-start")}>
      <div className="flex min-w-0 flex-col gap-0.5 md:pt-1.5">
        <label htmlFor={id} className="text-body-sm font-medium text-primary">
          {label}
        </label>
        {note}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">{children({ id, "aria-describedby": note ? noteId : undefined, invalid: Boolean(error) })}</div>
    </div>
  );
}

/** A list of setting rows; spacing alone separates them. */
export function SettingRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-col", className)}>{children}</div>;
}
