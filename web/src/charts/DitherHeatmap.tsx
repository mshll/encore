import { useId, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../ui/cx";
import { DITHER_LEVELS, ditherTile, TILE_STYLE } from "./ditherTile";

/** Linear-ish density so quiet cells stay faint and the busy ones stand out; any value lights at least one cell. */
const heatLevel = (share: number) => Math.max(1, Math.round(Math.pow(Math.min(1, share), 1.3) * DITHER_LEVELS));

export type HeatCell = { row: number; col: number };

type Props = {
  /** Row-major values: `values[row][col]`. */
  values: number[][];
  rowLabels: string[];
  /** Text, or a small element such as an avatar; hidden from assistive tech either way, since cells carry their own labels. */
  colLabels: ReactNode[];
  /** Which column labels to print; all columns stay navigable. */
  showCol?: (col: number) => boolean;
  showRow?: (row: number) => boolean;
  cellLabel: (cell: HeatCell) => string;
  selected: HeatCell | null;
  onSelect: (cell: HeatCell) => void;
  label: string;
  /** Height of one cell in px. Widths share the free space. */
  cellHeight: number;
  rowLabelWidth?: number;
  colLabelsAt?: "top" | "bottom";
};

/**
 * A grid of halftone cells: density follows the value, an empty cell keeps the faint well.
 * One tab stop; arrow keys move the selection (roving active descendant), Home and End jump within a row.
 */
export function DitherHeatmap({ values, rowLabels, colLabels, showCol = () => true, showRow = () => true, cellLabel, selected, onSelect, label, cellHeight, rowLabelWidth = 40, colLabelsAt = "bottom" }: Props) {
  const id = useId();
  const rows = values.length;
  const cols = values[0]?.length ?? 0;
  const max = Math.max(0, ...values.flat()) || 1;
  const cellId = (c: HeatCell) => `${id}-${c.row}-${c.col}`;

  const onKey = (e: KeyboardEvent) => {
    const at = selected ?? { row: 0, col: 0 };
    const moves: Record<string, HeatCell> = {
      ArrowLeft: { row: at.row, col: Math.max(0, at.col - 1) },
      ArrowRight: { row: at.row, col: Math.min(cols - 1, at.col + 1) },
      ArrowUp: { row: Math.max(0, at.row - 1), col: at.col },
      ArrowDown: { row: Math.min(rows - 1, at.row + 1), col: at.col },
      Home: { row: at.row, col: 0 },
      End: { row: at.row, col: cols - 1 },
    };
    const next = moves[e.key];
    if (!next) return;
    e.preventDefault();
    onSelect(next);
  };

  const axis = (
    <div aria-hidden className="grid gap-[2px]" style={{ gridTemplateColumns: `${rowLabelWidth}px repeat(${cols}, minmax(0, 1fr))` }}>
        <span />
        {colLabels.map((l, c) => (
          <span key={c} className="overflow-visible text-caption whitespace-nowrap text-tertiary tabular">
            {showCol(c) ? l : ""}
          </span>
        ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-1">
      {colLabelsAt === "top" && axis}
      <div
        role="grid"
        aria-label={label}
        aria-activedescendant={selected ? cellId(selected) : undefined}
        tabIndex={0}
        onKeyDown={onKey}
        className="grid gap-[2px] rounded-sm outline-offset-4"
        style={{ gridTemplateColumns: `${rowLabelWidth}px repeat(${cols}, minmax(0, 1fr))` }}
      >
        {values.map((row, r) => (
          <div key={r} role="row" className="contents">
            <span role="rowheader" className="flex min-w-0 items-center text-caption text-tertiary tabular" style={{ height: cellHeight }}>
              <span className={showRow(r) ? "truncate" : "sr-only"}>{rowLabels[r]}</span>
            </span>
            {row.map((v, c) => {
              const isSel = selected?.row === r && selected.col === c;
              return (
                <div
                  key={c}
                  id={cellId({ row: r, col: c })}
                  role="gridcell"
                  aria-selected={isSel}
                  aria-label={cellLabel({ row: r, col: c })}
                  onClick={() => onSelect({ row: r, col: c })}
                  className={cx("rounded-[2px] bg-chart-empty", isSel && "outline-2 outline-offset-1 outline-primary")}
                  style={{ height: cellHeight, backgroundImage: v > 0 ? ditherTile(heatLevel(v / max)) : undefined, ...TILE_STYLE }}
                />
              );
            })}
          </div>
        ))}
      </div>
      {colLabelsAt === "bottom" && axis}
    </div>
  );
}

/** Less to more key drawn from the same tiles. */
export function HeatLegend() {
  return (
    <div aria-hidden className="flex items-center gap-1.5 text-caption text-tertiary">
      Less
      {[0, 4, 8, 12, 16].map((l) => (
        <span key={l} className="size-3 rounded-[2px] bg-chart-empty" style={{ backgroundImage: l ? ditherTile(l) : undefined, ...TILE_STYLE }} />
      ))}
      More
    </div>
  );
}
