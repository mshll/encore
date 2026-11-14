import { useEnergy, useTagSeries } from "../api/queries";
import type { TagSeries } from "../api/types";
import { monthSequence } from "../lib/dates";
import { fmtHour, fmtHours, fmtMonth, fmtPct } from "../lib/format";
import type { Range } from "../lib/range";
import { Section } from "../ui/Page";
import { PALETTE, rgb } from "../components/dither-kit/palette";
import { DITHER_SERIES, DitherLine, DitherRadar, DitherStack } from "./Dither";
import { Legend } from "./Legend";
import { periodTick } from "./ticks";

const MAX = DITHER_SERIES.length;

function toRows(data: TagSeries) {
  const periods = [...new Set(data.series.map((s) => s.period))].sort();
  if (periods.length === 0) return null;
  const months = monthSequence(periods[0]!, periods[periods.length - 1]!);
  const top = data.totals.slice(0, MAX).map((t) => t.value);
  const series = top.map((value, i) => ({ key: `s${i}`, label: value, color: DITHER_SERIES[i]! }));
  const rows: Record<string, string | number>[] = months.map((m) => ({
    month: m,
    title: fmtMonth(m),
    ...Object.fromEntries(series.map((s) => [s.key, 0])),
    other: 0,
  }));
  const index = new Map(months.map((m, i) => [m, i]));
  for (const point of data.series) {
    const row = rows[index.get(point.period)!]!;
    const key = series.find((s) => s.label === point.value)?.key ?? "other";
    row[key] = Math.round(((row[key] as number) + point.hours) * 100) / 100;
  }
  const withOther = rows.some((r) => (r.other as number) > 0) ? [...series, { key: "other", label: "Other", color: "grey" as const }] : series;
  return { rows, series: withOther };
}

function Trend({ kind, title, range }: { kind: "genres" | "moods"; title: string; range: Range }) {
  const q = useTagSeries(kind, range, "month");
  if (!q.data || !q.data.coverage.share) return null;
  const built = toRows(q.data);
  if (!built) return null;
  return (
    <Section title={title} actions={<span className="text-caption text-secondary">Tagged songs cover {fmtPct(q.data.coverage.share)} of listening hours</span>}>
      <DitherStack
        label={`Hours per month by ${kind === "genres" ? "genre" : "mood"}`}
        rows={built.rows}
        xKey="month"
        tipLabel="title"
        series={built.series}
        xFormat={(m) => periodTick(m, "month")}
        format={fmtHours}
      />
      <Legend items={built.series.map((s) => ({ id: s.key, label: s.label, color: rgb(PALETTE[s.color].fill) }))} />
    </Section>
  );
}

function MoodProfile({ range }: { range: Range }) {
  const q = useTagSeries("moods", range, "month");
  if (!q.data || !q.data.coverage.share || q.data.totals.length < 3) return null;
  const total = q.data.totals.reduce((sum, t) => sum + t.hours, 0);
  const rows = q.data.totals.slice(0, 8).map((t) => ({ mood: t.value, share: Math.round((t.hours / total) * 1000) / 10 }));
  return (
    <Section title="Mood profile" actions={<span className="text-caption text-secondary">Share of tagged hours, top 8 moods</span>}>
      <DitherRadar label="Share of tagged listening hours by mood" rows={rows} nameKey="mood" valueKey="share" valueLabel="Share" format={(v) => `${v}%`} />
    </Section>
  );
}

const ENERGY_DOMAIN = [1, 5] as const;

function EnergyByHour({ range }: { range: Range }) {
  const q = useEnergy(range);
  if (!q.data || !q.data.coverage.share) return null;
  const rows = q.data.hours.filter((h) => h.energy !== null).map((h) => ({ hour: h.hour, title: fmtHour(h.hour), energy: h.energy! }));
  if (rows.length < 2) return null;
  return (
    <Section title="Energy by hour" actions={<span className="text-caption text-secondary">Average energy, 1 calm to 5 intense</span>}>
      <DitherLine
        label="Average song energy by hour of day"
        rows={rows}
        xKey="hour"
        tipLabel="title"
        valueKey="energy"
        valueLabel="Energy"
        yDomain={ENERGY_DOMAIN}
        xFormat={(h) => fmtHour(Number(h))}
        format={(v) => v.toFixed(1)}
      />
    </Section>
  );
}

export function TagTrends({ range }: { range: Range }) {
  return (
    <>
      <Trend kind="genres" title="Genres" range={range} />
      <div className="grid gap-10 md:gap-14 lg:grid-cols-2">
        <MoodProfile range={range} />
        <EnergyByHour range={range} />
      </div>
      <Trend kind="moods" title="Moods" range={range} />
    </>
  );
}
