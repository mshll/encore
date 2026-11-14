import { useMemo, useState, type ReactNode } from "react";
import { useEnergy, usePendingTags, useTagSeries, useTimeSeries } from "../api/queries";
import type { Energy, TagSeries } from "../api/types";
import { DitherArea, DitherLine } from "../charts/Dither";
import { DitherMeter } from "../charts/DitherMeter";
import { periodTick } from "../charts/ticks";
import { monthSequence } from "../lib/dates";
import { fmtHour, fmtHours, fmtInt, fmtMonth, fmtMonthLong, fmtPct } from "../lib/format";
import { leadInEnd } from "../lib/leadIn";
import { useRange, type Range } from "../lib/range";
import { cx } from "../ui/cx";
import { WaveformIcon } from "../ui/icons";
import { Section } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { Segmented } from "../ui/Segmented";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";
import { PatternsFrame } from "./PatternsFrame";

type Kind = "genres" | "moods";

const TAGS = 8;
const ENERGY_DOMAIN = [1, 5] as const;
const SPECIAL: Record<string, string> = { rnb: "R&B" };

const tagLabel = (tag: string) => SPECIAL[tag] ?? tag.charAt(0).toUpperCase() + tag.slice(1);
const pct = (v: number) => `${Math.round(v)}%`;

function TagList({ data, selected, onSelect, kind }: { data: TagSeries; selected: string; onSelect: (tag: string) => void; kind: Kind }) {
  const tagged = data.coverage.hoursTagged || 1;
  const top = data.totals.slice(0, TAGS);
  const max = top[0]?.hours || 1;
  return (
    <ul aria-label={kind === "genres" ? "Genres" : "Moods"} className="flex flex-col">
      {top.map((t) => {
        const active = t.value === selected;
        return (
          <li key={t.value}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(t.value)}
              className={cx(
                "-mx-2 grid h-(--row-h-compact) w-[calc(100%+1rem)] grid-cols-[minmax(0,7rem)_minmax(0,1fr)_3rem] items-center gap-3 rounded-md px-2 text-left transition-colors duration-150 hover:bg-fill",
                active && "bg-fill",
              )}
            >
              <span className={cx("truncate", active ? "font-medium text-primary" : "text-secondary")}>{tagLabel(t.value)}</span>
              <DitherMeter share={t.hours / max} />
              <span className="text-right text-secondary tabular">{fmtPct(t.hours / tagged)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TagTrend({ data, tag, range }: { data: TagSeries; tag: string; range: Range }) {
  const months = useTimeSeries(range, "month");
  const trend = useMemo(() => {
    const periods = data.series.map((p) => p.period).sort();
    if (!months.data || periods.length === 0) return null;
    const totals = new Map(months.data.points.map((p) => [p.period, p.hours]));
    const hours = new Map(data.series.filter((p) => p.value === tag).map((p) => [p.period, p.hours]));
    const all = monthSequence(periods[0]!, periods[periods.length - 1]!);
    const start = leadInEnd(all.map((m) => totals.get(m) ?? 0));
    const rows = all.slice(start).map((m) => {
      const total = totals.get(m) ?? 0;
      return { month: m, title: fmtMonth(m), share: total > 0 ? Math.round(((hours.get(m) ?? 0) / total) * 1000) / 10 : 0 };
    });
    return { rows, from: start > 0 ? all[start]! : null };
  }, [data, tag, months.data]);
  if (months.isError) return <ErrorState size="inline" error={months.error} onRetry={() => months.refetch()} />;
  if (!months.data) return <Skeleton className="h-60 w-full" />;
  if (!trend) return null;
  return (
    <>
      <DitherArea
        label={`Share of listening hours tagged ${tagLabel(tag)}, by month`}
        rows={trend.rows}
        xKey="month"
        tipLabel="title"
        valueKey="share"
        valueLabel={tagLabel(tag)}
        xFormat={(m) => periodTick(m, "month")}
        format={pct}
      />
      {trend.from && <p className="text-caption text-secondary">Starts {fmtMonthLong(trend.from)}; the quiet months before it are left out.</p>}
    </>
  );
}

function energyLine(hours: Energy["hours"]): string | null {
  const known = hours.filter((h) => h.energy !== null);
  if (known.length < 2) return null;
  const high = known.reduce((a, b) => (b.energy! > a.energy! ? b : a));
  const low = known.reduce((a, b) => (b.energy! < a.energy! ? b : a));
  return `Most intense around ${fmtHour(high.hour)} (${high.energy!.toFixed(1)} of 5), calmest around ${fmtHour(low.hour)} (${low.energy!.toFixed(1)}).`;
}

function EnergyByHour({ range }: { range: Range }) {
  const q = useEnergy(range);
  if (q.isError) return <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-52 w-full" />;
  const rows = q.data.hours.filter((h) => h.energy !== null).map((h) => ({ hour: h.hour, title: fmtHour(h.hour), energy: h.energy! }));
  const line = energyLine(q.data.hours);
  if (!line) return null;
  return (
    <Section title="Energy through the day" description={line}>
      <DitherLine
        label="Average song energy by hour, 1 calm to 5 intense"
        rows={rows}
        xKey="hour"
        tipLabel="title"
        valueKey="energy"
        valueLabel="Energy"
        yDomain={ENERGY_DOMAIN}
        xFormat={(h) => fmtHour(Number(h))}
        format={(v) => v.toFixed(1)}
        height={180}
      />
    </Section>
  );
}

function Untagged() {
  const pending = usePendingTags();
  const count = pending.data?.total;
  return (
    <EmptyState
      size="section"
      icon={WaveformIcon}
      title="No songs tagged yet"
      description={`${count ? `${fmtInt(count)} played songs have no tags. ` : ""}Tag them through the tags API or MCP to see genres, moods and energy here.`}
    />
  );
}

function TasteView({ range }: { range: Range }) {
  const [kind, setKind] = useState<Kind>("genres");
  const [picked, setPicked] = useState<Record<Kind, string | null>>({ genres: null, moods: null });
  const q = useTagSeries(kind, range, "month");

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div aria-busy className="flex flex-col gap-6">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-5 w-full max-w-md" />
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          <Skeleton className="h-60 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      </div>
    );
  const { coverage, totals } = q.data;
  if (coverage.hoursTotal === 0) return <EmptyState size="section" title="No plays in this range" description="Pick a wider range to see your genres and moods." action={<RangePicker />} />;
  if (!coverage.share || totals.length === 0) return <Untagged />;

  const tag = picked[kind] && totals.some((t) => t.value === picked[kind]) ? picked[kind]! : totals[0]!.value;
  const lead = totals[0]!;
  const noun = kind === "genres" ? "genre" : "mood";

  return (
    <div className={cx("flex flex-col gap-10 transition-opacity duration-200", q.isPlaceholderData && "opacity-60")}>
      <div className="flex flex-col gap-5">
        <Segmented<Kind>
          label="Tag kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "genres", label: "Genres" },
            { value: "moods", label: "Moods" },
          ]}
          className="w-full max-w-60"
        />
        <p className="text-body text-pretty">
          Top {noun}: <span className="font-medium">{tagLabel(lead.value)}</span>, in {fmtPct(lead.hours / coverage.hoursTagged)} of tagged listening ({fmtHours(lead.hours)}).
        </p>
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          <div className="flex min-w-0 flex-col gap-3 max-lg:order-2">
            <h2 className="text-heading font-medium">{tagLabel(tag)} over time</h2>
            <TagTrend data={q.data} tag={tag} range={range} />
          </div>
          <TagList data={q.data} kind={kind} selected={tag} onSelect={(t) => setPicked((p) => ({ ...p, [kind]: t }))} />
        </div>
        {coverage.share < 0.98 && <p className="text-caption text-secondary">Tags cover {fmtPct(coverage.share)} of listening hours in this range.</p>}
      </div>
      <EnergyByHour range={range} />
    </div>
  );
}

export function Taste(): ReactNode {
  const { range } = useRange();
  return (
    <PatternsFrame icon={WaveformIcon} firstUse="Once plays come in and songs are tagged, this shows your genres, moods and energy over time.">
      <TasteView range={range} />
    </PatternsFrame>
  );
}
