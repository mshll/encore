import { useMemo, useState } from "react";
import { useClock, useTopArtists, useTopTracks } from "../api/queries";
import type { Clock } from "../api/types";
import { DataTable } from "../charts/DataTable";
import { DitherHeatmap, HeatLegend, type HeatCell } from "../charts/DitherHeatmap";
import { DitherMeter } from "../charts/DitherMeter";
import { fmtHour, fmtHours, fmtHoursValue, fmtCompact, fmtInt, WEEKDAYS, WEEKDAYS_SHORT } from "../lib/format";
import { useRange, type Range } from "../lib/range";
import { useDesktop } from "../lib/useMedia";
import { cx } from "../ui/cx";
import { ClockIcon } from "../ui/icons";
import { SECTIONS, SIDE_COLUMNS, Section, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { ArtistRow, RowList, RowSkeleton, TrackRow } from "../ui/Rows";
import { ChartSkeleton, Skeleton } from "../ui/Skeleton";
import { StatStrip, type StatItem } from "../ui/Stat";
import { EmptyState, ErrorState } from "../ui/States";
import { PatternsFrame } from "./PatternsFrame";

type Metric = "hours" | "plays";
type Cell = Clock["cells"][number];
/** API weekday (1 Monday to 7 Sunday) and hour. */
type Slot = { weekday: number; hour: number };

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const plural = (weekday: number) => `${WEEKDAYS[weekday - 1]}s`;
const slotTitle = (s: Slot) => `${plural(s.weekday)}, ${fmtHour(s.hour)} to ${fmtHour((s.hour + 1) % 24)}`;
const valueOf = (c: Cell, m: Metric) => (m === "hours" ? c.hours : c.plays);
const fmtValue = (v: number, m: Metric) => (m === "hours" ? fmtHours(v) : `${fmtInt(v)} ${v === 1 ? "play" : "plays"}`);

/** 7 x 24 lookup, Monday first. */
function grid(cells: Cell[]): Cell[][] {
  const out = Array.from({ length: 7 }, (_, d) => HOURS.map((hour) => ({ weekday: d + 1, hour, hours: 0, plays: 0 })));
  for (const c of cells) out[c.weekday - 1]![c.hour] = c;
  return out;
}

function peak(cells: Cell[], m: Metric): Cell | undefined {
  return cells.reduce<Cell | undefined>((best, c) => (!best || valueOf(c, m) > valueOf(best, m) ? c : best), undefined);
}

function Heatmap({ days, metric, selected, onSelect }: { days: Cell[][]; metric: Metric; selected: Slot; onSelect: (s: Slot) => void }) {
  const desktop = useDesktop();
  const at = (s: Slot) => days[s.weekday - 1]![s.hour]!;
  const label = (s: Slot) => {
    const c = at(s);
    return `${slotTitle(s)}: ${fmtHours(c.hours)}, ${fmtInt(c.plays)} plays`;
  };
  // Desktop: weekdays down, hours across. Phone: hours down, weekdays across, so cells stay tappable.
  if (desktop)
    return (
      <DitherHeatmap
        label="Listening by weekday and hour. Arrow keys move the selection."
        values={days.map((row) => row.map((c) => valueOf(c, metric)))}
        rowLabels={WEEKDAYS_SHORT}
        colLabels={HOURS.map((h) => String(h).padStart(2, "0"))}
        showCol={(h) => h % 3 === 0}
        cellLabel={({ row, col }) => label({ weekday: row + 1, hour: col })}
        selected={{ row: selected.weekday - 1, col: selected.hour }}
        onSelect={({ row, col }: HeatCell) => onSelect({ weekday: row + 1, hour: col })}
        cellHeight={28}
      />
    );
  return (
    <DitherHeatmap
      label="Listening by hour and weekday. Arrow keys move the selection."
      values={HOURS.map((h) => days.map((row) => valueOf(row[h]!, metric)))}
      rowLabels={HOURS.map(fmtHour)}
      showRow={(h) => h % 3 === 0}
      colLabels={WEEKDAYS_SHORT}
      colLabelsAt="top"
      cellLabel={({ row, col }) => label({ weekday: col + 1, hour: row })}
      selected={{ row: selected.hour, col: selected.weekday - 1 }}
      onSelect={({ row, col }: HeatCell) => onSelect({ weekday: col + 1, hour: row })}
      cellHeight={20}
      rowLabelWidth={48}
    />
  );
}

function SlotDetail({ slot, cell, range }: { slot: Slot; cell: Cell; range: Range }) {
  const at = { weekday: slot.weekday, hour: slot.hour };
  const songs = useTopTracks(range, 5, at, cell.plays > 0);
  const artists = useTopArtists(range, 5, at);
  const songMax = songs.data?.items[0]?.hours || 1;
  const artistMax = artists.data?.items[0]?.hours || 1;
  return (
    <Section title={slotTitle(slot)} description={cell.plays === 0 ? undefined : `${fmtHours(cell.hours)} over ${fmtInt(cell.plays)} ${cell.plays === 1 ? "play" : "plays"}`} labelledBy="when-slot">
      {cell.plays === 0 ? (
        <EmptyState size="inline" title="Nothing played in this hour" />
      ) : (
        <div className="grid gap-8 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="font-medium text-secondary">Songs</h3>
            {songs.isError ? (
              <ErrorState size="inline" error={songs.error} onRetry={() => songs.refetch()} />
            ) : !songs.data ? (
              <RowSkeleton rows={5} rank />
            ) : (
              <RowList label={`Top songs, ${slotTitle(slot)}`}>
                {songs.data.items.map((s, i) => (
                  <TrackRow key={s.songKey} song={s} rank={i + 1} value={fmtHours(s.hours)} share={s.hours / songMax} />
                ))}
              </RowList>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="font-medium text-secondary">Artists</h3>
            {artists.isError ? (
              <ErrorState size="inline" error={artists.error} onRetry={() => artists.refetch()} />
            ) : !artists.data ? (
              <RowSkeleton rows={5} rank />
            ) : (
              <RowList label={`Top artists, ${slotTitle(slot)}`}>
                {artists.data.items.map((a, i) => (
                  <ArtistRow key={a.artist} artist={a} rank={i + 1} value={fmtHours(a.hours)} share={a.hours / artistMax} />
                ))}
              </RowList>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function ByWeekday({ days, metric }: { days: Cell[][]; metric: Metric }) {
  const totals = days.map((row) => row.reduce((sum, c) => sum + valueOf(c, metric), 0));
  const max = Math.max(...totals) || 1;
  return (
    <Section title="By weekday">
      <ol className="flex flex-col">
        {totals.map((v, d) => (
          <li key={d} className="grid h-(--row-h-compact) grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_4.5rem] items-center gap-3">
            <span className="truncate">{WEEKDAYS[d]}</span>
            <DitherMeter share={v / max} />
            <span className="text-right text-secondary tabular">{metric === "hours" ? fmtHours(v) : fmtCompact(v)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function ClockView({ range }: { range: Range }) {
  const q = useClock(range);
  const [metric, setMetric] = useState<Metric>("hours");
  const [picked, setPicked] = useState<Slot | null>(null);
  const cells = q.data?.cells;
  const days = useMemo(() => grid(cells ?? []), [cells]);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!cells)
    return (
      <div aria-busy className="flex flex-col gap-6">
        <div className="flex gap-10">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2 pb-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
        <ChartSkeleton shape="grid" className="h-[480px] md:h-[226px]" />
      </div>
    );

  const hours = cells.reduce((s, c) => s + c.hours, 0);
  const plays = cells.reduce((s, c) => s + c.plays, 0);
  if (plays === 0) return <EmptyState size="section" title="No plays in this range" description="Pick a wider range to see when you listen." action={<RangePicker />} />;

  const top = peak(cells, metric)!;
  const slot = picked ?? { weekday: top.weekday, hour: top.hour };
  const cell = days[slot.weekday - 1]![slot.hour]!;
  const figures: StatItem<Metric>[] = [
    { id: "hours", label: "Time listened", value: fmtHoursValue(hours), unit: "hours" },
    { id: "plays", label: "Plays", value: fmtCompact(plays) },
  ];

  return (
    <div className={cx(SECTIONS, dimWhile(q.isPlaceholderData))}>
      <StatStrip items={figures} value={metric} onChange={setMetric} label="Listening figures">
        <div className="flex flex-col gap-4 pt-5">
          <p className="text-body text-pretty">
            Busiest: <span className="font-medium">{slotTitle(top)}</span>, {fmtValue(valueOf(top, metric), metric)}.
          </p>
          <Heatmap days={days} metric={metric} selected={slot} onSelect={setPicked} />
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <HeatLegend />
            <DataTable
              label="Listening by weekday and hour"
              head={["Slot", "Hours", "Plays"]}
              rows={days.flat().map((c) => ({ key: `${c.weekday}-${c.hour}`, cells: [`${WEEKDAYS_SHORT[c.weekday - 1]} ${fmtHour(c.hour)}`, fmtHoursValue(c.hours), fmtInt(c.plays)] }))}
            />
          </div>
        </div>
      </StatStrip>
      <div className={SIDE_COLUMNS}>
        <SlotDetail slot={slot} cell={cell} range={range} />
        <ByWeekday days={days} metric={metric} />
      </div>
    </div>
  );
}

export function When() {
  const { range } = useRange();
  return (
    <PatternsFrame icon={ClockIcon} firstUse="Once plays come in, this shows the hours and weekdays you listen most.">
      <ClockView range={range} />
    </PatternsFrame>
  );
}
