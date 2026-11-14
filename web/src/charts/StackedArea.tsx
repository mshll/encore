import { useState } from "react";
import { fmtMonth, fmtMonthShort } from "../lib/format";
import { ChartTooltip, niceTicks, TooltipRow, useWidth } from "./core";
import { DataTable } from "./DataTable";

export type AreaSeries = { id: string; label: string; values: number[]; color: string };

export function StackedArea({
  months,
  series,
  height = 260,
  format,
  label,
  highlight,
  selectedMonth,
  onSelectMonth,
}: {
  months: string[];
  series: AreaSeries[];
  height?: number;
  format: (v: number) => string;
  label: string;
  highlight?: string | null;
  selectedMonth?: string | null;
  onSelectMonth?: (month: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const axisH = 24;
  const plotH = height - axisH;
  const n = months.length;
  const totals = months.map((_, j) => series.reduce((sum, s) => sum + (s.values[j] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals), 3);
  const top = ticks[ticks.length - 1] || 1;
  const x = (j: number) => (n <= 1 ? width / 2 : (j / (n - 1)) * width);
  const y = (v: number) => plotH - (v / top) * (plotH - 16);

  const lower = months.map(() => 0);
  const shapes = series.map((s) => {
    const base = [...lower];
    const upper = base.map((b, j) => b + (s.values[j] ?? 0));
    upper.forEach((u, j) => (lower[j] = u));
    const up = upper.map((u, j) => `${x(j)},${y(u)}`).join("L");
    const down = base
      .map((b, j) => `${x(j)},${y(b)}`)
      .reverse()
      .join("L");
    return { s, d: `M${up}L${down}Z`, line: `M${up}` };
  });

  const years = months.map((m, j) => (m.endsWith("-01") ? j : -1)).filter((j) => j >= 0);
  const step = Math.max(1, Math.ceil(years.length / Math.max(2, Math.floor(width / 56))));
  const labels =
    years.length >= 2
      ? years.filter((_, k) => k % step === 0).map((j) => ({ j, text: months[j]!.slice(0, 4) }))
      : months.map((m, j) => ({ j, text: fmtMonthShort(m) })).filter((_, j) => j % Math.max(1, Math.ceil(n / 6)) === 0);

  const indexAt = (clientX: number, rect: DOMRect) => Math.max(0, Math.min(n - 1, Math.round(((clientX - rect.left) / rect.width) * (n - 1))));
  const selectedIdx = selectedMonth ? months.indexOf(selectedMonth) : -1;

  return (
    <div className="flex w-full flex-col gap-2">
      <div ref={ref} className="relative w-full select-none" style={{ height }}>
        {width > 0 && n > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={label}
            tabIndex={0}
            className="block overflow-visible outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            onPointerMove={(e) => setActive(indexAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
            onPointerLeave={() => setActive(null)}
            onBlur={() => setActive(null)}
            onClick={(e) => onSelectMonth?.(months[indexAt(e.clientX, e.currentTarget.getBoundingClientRect())]!)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") setActive((i) => Math.min(n - 1, (i ?? -1) + 1));
              else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? n) - 1));
              else if ((e.key === "Enter" || e.key === " ") && active !== null) onSelectMonth?.(months[active]!);
              else return;
              e.preventDefault();
            }}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--chart-axis)" : "var(--chart-grid)"} shapeRendering="crispEdges" />
              </g>
            ))}
            {shapes.map(({ s, d }) => (
              <path key={s.id} d={d} fill={s.color} opacity={highlight && highlight !== s.id ? 0.18 : 0.9} className="transition-opacity duration-200" />
            ))}
            {shapes.map(({ s, line }) => (
              <path key={`${s.id}-edge`} d={line} fill="none" stroke="var(--page)" strokeWidth={1} strokeLinejoin="round" />
            ))}
            {ticks
              .filter((t) => t > 0)
              .map((t) => (
                <text
                  key={`l${t}`}
                  x={0}
                  y={y(t) - 4}
                  className="fill-(--chart-axis) text-label tabular"
                  paintOrder="stroke"
                  stroke="var(--page)"
                  strokeWidth={3}
                >
                  {format(t)}
                </text>
              ))}
            {selectedIdx >= 0 && <line x1={x(selectedIdx)} x2={x(selectedIdx)} y1={0} y2={plotH} stroke="var(--text-primary)" strokeWidth={1.5} />}
            {active !== null && <line x1={x(active)} x2={x(active)} y1={0} y2={plotH} stroke="var(--text-secondary)" strokeWidth={1} />}
            {labels.map(({ j, text }) => (
              <text
                key={j}
                x={x(j)}
                y={height - 6}
                textAnchor={j === 0 ? "start" : j === n - 1 ? "end" : "middle"}
                className="fill-(--chart-axis) text-label tabular"
              >
                {text}
              </text>
            ))}
          </svg>
        )}
        {active !== null && (
          <ChartTooltip x={x(active)} y={Math.max(0, y(totals[active]!) - 8)} width={width}>
            <div className="mb-1 font-normal text-on-standout-secondary">{fmtMonth(months[active]!)}</div>
            {[...series]
              .reverse()
              .filter((s) => (s.values[active] ?? 0) > 0)
              .map((s) => (
                <TooltipRow key={s.id} color={s.color} value={format(s.values[active]!)} label={s.label} />
              ))}
            {totals[active] === 0 && <div className="font-normal">Nothing played</div>}
          </ChartTooltip>
        )}
      </div>
      <DataTable
        label={label}
        head={["Month", ...series.map((s) => s.label)]}
        rows={months.flatMap((m, j) => (totals[j]! > 0 ? [{ key: m, cells: [fmtMonth(m), ...series.map((s) => format(s.values[j] ?? 0))] }] : []))}
      />
    </div>
  );
}

export const SERIES_COLORS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
