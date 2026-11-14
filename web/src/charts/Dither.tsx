import type { ReactNode } from "react";
import { useDesktop } from "../lib/useMedia";
import { DataTable } from "./DataTable";
import { Area, Line } from "../components/dither-kit/area";
import { AreaChart, LineChart } from "../components/dither-kit/area-chart";
import { Bar } from "../components/dither-kit/bar";
import { BarChart } from "../components/dither-kit/bar-chart";
import type { ChartConfig } from "../components/dither-kit/chart-context";
import { Grid } from "../components/dither-kit/grid";
import type { DitherColor } from "../components/dither-kit/palette";
import { Radar } from "../components/dither-kit/radar";
import { RadarChart } from "../components/dither-kit/radar-chart";
import { Tooltip } from "../components/dither-kit/tooltip";
import { XAxis } from "../components/dither-kit/x-axis";
import { YAxis } from "../components/dither-kit/y-axis";

export const DITHER_SERIES: DitherColor[] = ["blue", "orange", "purple", "pink", "red", "green"];

type Column = { key: string; label: string };
type Row = Record<string, string | number>;

function Frame({
  label,
  height,
  columns,
  rows,
  format,
  children,
}: {
  label: string;
  height: number;
  columns: Column[];
  rows: Row[];
  format: (v: number) => string;
  children: ReactNode;
}) {
  const [head, ...values] = columns;
  return (
    <figure role="group" aria-label={label} className="flex w-full flex-col gap-2">
      <div aria-hidden className="relative w-full [&_.font-mono]:font-sans [&_.font-mono]:text-label [&_.font-mono]:tabular-nums" style={{ height }}>
        {children}
      </div>
      <DataTable
        label={label}
        head={columns.map((c) => c.label)}
        rows={rows.map((r, i) => ({ key: String(i), cells: [String(r[head!.key]), ...values.map((c) => format(Number(r[c.key] ?? 0)))] }))}
      />
    </figure>
  );
}

export function DitherBars({
  label,
  rows,
  xKey,
  valueKey,
  valueLabel,
  xFormat,
  tipLabel,
  format,
  height = 220,
}: {
  label: string;
  rows: Row[];
  xKey: string;
  valueKey: string;
  valueLabel: string;
  xFormat: (v: string, i: number) => string;
  tipLabel: string;
  format: (v: number) => string;
  height?: number;
}) {
  const config: ChartConfig = { [valueKey]: { label: valueLabel, color: "green" } };
  const ticks = useDesktop() ? 7 : 4;
  return (
    <Frame
      label={label}
      height={height}
      columns={[
        { key: tipLabel, label: "Period" },
        { key: valueKey, label: valueLabel },
      ]}
      rows={rows}
      format={format}
    >
      <BarChart data={rows} config={config} margins={{ left: 44 }} className="size-full">
        <Grid />
        <XAxis dataKey={xKey} tickFormatter={(v, i) => xFormat(String(v), i)} maxTicks={ticks} />
        <YAxis tickFormatter={(v) => (v === 0 ? "0" : format(v))} />
        <Tooltip labelKey={tipLabel} valueFormatter={(v) => format(v)} />
        <Bar dataKey={valueKey} variant="gradient" />
      </BarChart>
    </Frame>
  );
}

/** One series over time as a dithered area: the chart under a StatStrip. */
export function DitherArea({
  label,
  rows,
  xKey,
  valueKey,
  valueLabel,
  xFormat,
  tipLabel,
  format,
  height = 240,
}: {
  label: string;
  rows: Row[];
  xKey: string;
  valueKey: string;
  valueLabel: string;
  xFormat: (v: string, i: number) => string;
  tipLabel: string;
  format: (v: number) => string;
  height?: number;
}) {
  const config: ChartConfig = { [valueKey]: { label: valueLabel, color: "green" } };
  const ticks = useDesktop() ? 7 : 4;
  return (
    <Frame
      label={label}
      height={height}
      columns={[
        { key: tipLabel, label: "Period" },
        { key: valueKey, label: valueLabel },
      ]}
      rows={rows}
      format={format}
    >
      <AreaChart data={rows} config={config} margins={{ left: 44 }} className="size-full">
        <Grid />
        <XAxis dataKey={xKey} tickFormatter={(v, i) => xFormat(String(v), i)} maxTicks={ticks} />
        <YAxis tickFormatter={(v) => (v === 0 ? "0" : format(v))} />
        <Tooltip labelKey={tipLabel} valueFormatter={(v) => format(v)} />
        <Area dataKey={valueKey} variant="gradient" />
      </AreaChart>
    </Frame>
  );
}

export function DitherStack({
  label,
  rows,
  xKey,
  tipLabel,
  series,
  xFormat,
  format,
  height = 240,
}: {
  label: string;
  rows: Row[];
  xKey: string;
  tipLabel: string;
  series: { key: string; label: string; color: DitherColor }[];
  xFormat: (v: string, i: number) => string;
  format: (v: number) => string;
  height?: number;
}) {
  const config: ChartConfig = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));
  const ticks = useDesktop() ? 7 : 4;
  return (
    <Frame
      label={label}
      height={height}
      columns={[{ key: tipLabel, label: "Month" }, ...series.map((s) => ({ key: s.key, label: s.label }))]}
      rows={rows}
      format={format}
    >
      <AreaChart data={rows} config={config} stackType="stacked" margins={{ left: 44 }} className="size-full">
        <Grid />
        <XAxis dataKey={xKey} tickFormatter={(v, i) => xFormat(String(v), i)} maxTicks={ticks} />
        <YAxis tickFormatter={(v) => (v === 0 ? "0" : format(v))} />
        <Tooltip labelKey={tipLabel} valueFormatter={(v) => format(v)} />
        {series.map((s) => (
          <Area key={s.key} dataKey={s.key} variant="gradient" />
        ))}
      </AreaChart>
    </Frame>
  );
}

export function DitherLine({
  label,
  rows,
  xKey,
  tipLabel,
  valueKey,
  valueLabel,
  xFormat,
  format,
  yDomain,
  height = 200,
}: {
  label: string;
  rows: Row[];
  yDomain?: readonly [number, number];
  xKey: string;
  tipLabel: string;
  valueKey: string;
  valueLabel: string;
  xFormat: (v: string, i: number) => string;
  format: (v: number) => string;
  height?: number;
}) {
  const config: ChartConfig = { [valueKey]: { label: valueLabel, color: "green" } };
  const ticks = useDesktop() ? 8 : 4;
  return (
    <Frame
      label={label}
      height={height}
      columns={[
        { key: tipLabel, label: "Hour" },
        { key: valueKey, label: valueLabel },
      ]}
      rows={rows}
      format={format}
    >
      <LineChart data={rows} config={config} yDomain={yDomain} margins={{ left: 44 }} className="size-full">
        <Grid />
        <XAxis dataKey={xKey} tickFormatter={(v, i) => xFormat(String(v), i)} maxTicks={ticks} />
        <YAxis tickFormatter={(v) => (v === 0 ? "0" : format(v))} />
        <Tooltip labelKey={tipLabel} valueFormatter={(v) => format(v)} />
        <Line dataKey={valueKey} />
      </LineChart>
    </Frame>
  );
}

export function DitherRadar({
  label,
  rows,
  nameKey,
  valueKey,
  valueLabel,
  format,
  height = 300,
}: {
  label: string;
  rows: Row[];
  nameKey: string;
  valueKey: string;
  valueLabel: string;
  format: (v: number) => string;
  height?: number;
}) {
  const config: ChartConfig = { [valueKey]: { label: valueLabel, color: "green" } };
  return (
    <Frame
      label={label}
      height={height}
      columns={[
        { key: nameKey, label: "Tag" },
        { key: valueKey, label: valueLabel },
      ]}
      rows={rows}
      format={format}
    >
      <RadarChart data={rows} config={config} nameKey={nameKey} className="size-full">
        <Tooltip valueFormatter={(v) => format(v)} />
        <Radar dataKey={valueKey} variant="gradient" />
      </RadarChart>
    </Frame>
  );
}
