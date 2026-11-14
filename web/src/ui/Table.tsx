import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

export type Column = {
  id: string;
  label: ReactNode;
  /** A CSS grid track, e.g. "48px" or "minmax(0,2fr)". */
  width: string;
  align?: "start" | "end";
  /** Drop the column when the table itself is narrower than this (md 560, lg 760, xl 960 px). */
  from?: "md" | "lg" | "xl";
  /** Hidden header text (for art and action columns). */
  srLabel?: boolean;
};

const MIN_WIDTH = { md: 560, lg: 760, xl: 960 } as const;

/** Columns that fit the table's own width become the grid template; the rest drop out of it. */
export function useColumns(columns: Column[], width: number) {
  const visible = columns.filter((c) => !c.from || width >= MIN_WIDTH[c.from]);
  return { visible, style: { gridTemplateColumns: visible.map((c) => c.width).join(" ") } as CSSProperties };
}

/** Header row: plain muted caption text over the columns. Spacing, not a rule, separates it from the rows. */
export function TableHead({ columns, style, className }: { columns: Column[]; style: CSSProperties; className?: string }) {
  return (
    <div role="row" className={cx("grid h-9 items-center gap-4 px-2 text-caption text-secondary", className)} style={style}>
      {columns.map((c) => (
        <span key={c.id} role="columnheader" className={cx("min-w-0 truncate", c.align === "end" && "text-right")}>
          {c.srLabel ? <span className="sr-only">{c.label}</span> : c.label}
        </span>
      ))}
    </div>
  );
}

/** Cells render only for `visible` columns, so the grid template and the cells always match. */
export function cellClass(c: Column, extra?: string) {
  return cx("min-w-0", c.align === "end" && "text-right", extra);
}
