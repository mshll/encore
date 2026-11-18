import { useState } from "react";
import { usePlayStarts } from "../../api/queries";
import type { PlayStarts, StartKind } from "../../api/types";
import { DitherBars } from "../../charts/Dither";
import { RateMeter } from "../../charts/RateMeter";
import { periodTick } from "../../charts/ticks";
import { monthSequence } from "../../lib/dates";
import { fmtInt, fmtMonth, fmtMonthLong, fmtPct } from "../../lib/format";
import { leadInEnd } from "../../lib/leadIn";
import type { Range } from "../../lib/range";
import { useDesktop } from "../../lib/useMedia";
import { Section, dimWhile } from "../../ui/Page";
import { ChartSkeleton } from "../../ui/Skeleton";
import { StatStrip, type StatItem } from "../../ui/Stat";
import { EmptyState, ErrorState } from "../../ui/States";

type Metric = "chosen" | "playedOn" | "shuffled";

const KINDS: { kind: StartKind; label: string }[] = [
  { kind: "chosen", label: "You chose" },
  { kind: "playedOn", label: "Played on" },
  { kind: "nextBack", label: "Next or back" },
  { kind: "other", label: "Other" },
];
const METRIC_LABEL: Record<Metric, string> = { chosen: "You chose", playedOn: "Played on", shuffled: "On shuffle" };

type Month = PlayStarts["months"][number];

function trend(months: Month[], metric: Metric) {
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const all = monthSequence(months[0]!.month, months.at(-1)!.month);
  const start = leadInEnd(all.map((m) => byMonth.get(m)?.plays ?? 0));
  return {
    rows: all.slice(start).map((month) => ({ month, title: fmtMonth(month), value: Math.round((byMonth.get(month)?.shares[metric] ?? 0) * 1000) / 10 })),
    cutFrom: start > 0 ? all[start]! : null,
  };
}

function Breakdown({ totals }: { totals: PlayStarts["totals"] }) {
  return (
    <ul className="flex max-w-xl flex-col">
      {KINDS.map(({ kind, label }) => (
        <li key={kind} className="grid h-(--row-h-compact) grid-cols-[minmax(0,8rem)_minmax(0,1fr)_2.75rem] items-center gap-3">
          <span className="truncate" title={`${fmtInt(totals[kind])} plays`}>
            {label}
          </span>
          <RateMeter rate={totals.shares[kind] ?? 0} />
          <span className="text-right text-secondary tabular">{fmtPct(totals.shares[kind])}</span>
        </li>
      ))}
    </ul>
  );
}

function StartsBody({ data }: { data: PlayStarts }) {
  const desktop = useDesktop();
  const [metric, setMetric] = useState<Metric>("chosen");
  const { totals, coverage } = data;
  const figures: StatItem<Metric>[] = (["chosen", "playedOn", "shuffled"] as const).map((id) => ({ id, label: METRIC_LABEL[id], value: fmtPct(totals.shares[id]) }));
  const t = trend(data.months, metric);
  return (
    <div className="flex flex-col gap-6">
      <StatStrip items={figures} value={metric} onChange={setMetric} label="How plays start">
        <div className="flex flex-col gap-3 pt-5">
          <DitherBars
            label={`${METRIC_LABEL[metric]}, share of plays each month`}
            rows={t.rows}
            xKey="month"
            tipLabel="title"
            valueKey="value"
            valueLabel={METRIC_LABEL[metric]}
            xFormat={(p) => periodTick(p, "month")}
            format={(v) => `${Math.round(v)}%`}
            table={{ format: (v) => String(Math.round(v)), unit: "%" }}
            height={desktop ? 160 : 120}
          />
          {t.cutFrom && <p className="text-caption text-secondary">Starts {fmtMonthLong(t.cutFrom)}; the quiet months before it are left out.</p>}
        </div>
      </StatStrip>
      <Breakdown totals={totals} />
      {coverage.share !== null && coverage.share < 0.98 && (
        <p className="text-caption text-secondary">
          Counts {fmtInt(coverage.counted)} of {fmtInt(coverage.plays)} plays: only the Spotify export records how a play started.
        </p>
      )}
    </div>
  );
}

export function StartsSection({ range }: { range: Range }) {
  const q = usePlayStarts(range);
  return (
    <Section title="How plays start" labelledBy="skips-starts">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <ChartSkeleton className="h-[248px]" />
      ) : q.data.totals.plays === 0 ? (
        <EmptyState size="inline" title="No play in this range records how it started" description="Start reasons come from the Spotify export. Pick a range it covers." />
      ) : (
        <div className={dimWhile(q.isPlaceholderData)}>
          <StartsBody data={q.data} />
        </div>
      )}
    </Section>
  );
}
