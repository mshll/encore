import { useMemo, useState, type ReactNode } from "react";
import { useArtistPage, useEras, useTopArtists } from "../api/queries";
import type { Eras as ErasData } from "../api/types";
import { artistPath } from "../app/paths";
import { DataTable } from "../charts/DataTable";
import { DitherHeatmap, HeatLegend, type HeatCell } from "../charts/DitherHeatmap";
import { monthBounds } from "../lib/dates";
import { leadInEnd } from "../lib/leadIn";
import { fmtHours, fmtHoursValue, fmtMonth, fmtMonthLong, fmtMonthShort } from "../lib/format";
import { useRange, type Range } from "../lib/range";
import { useDesktop } from "../lib/useMedia";
import { Artwork } from "../ui/Artwork";
import { cx } from "../ui/cx";
import { ChartBarIcon } from "../ui/icons";
import { SECTIONS, SIDE_COLUMNS, Section, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { ArtistRow, Row, RowList, RowSkeleton, TrackRow } from "../ui/Rows";
import { ChartSkeleton, Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";
import { StartSessionButton } from "../ui/StartSessionButton";
import { PatternsFrame } from "./PatternsFrame";

const ARTISTS = 10;

type Era = ErasData["artists"][number];
/** Artist row index and month column index into the trimmed grid. */
type Pick = { artist: number; month: number };
type Run = { artist: number; first: number; last: number };

/** The longest stretch of consecutive months one artist led; the earliest wins a tie. */
function longestRun(hours: number[][], months: number): Run | null {
  const runs: Run[] = [];
  for (let j = 0; j < months; j++) {
    let leader = -1;
    for (let i = 0; i < hours.length; i++) if ((hours[i]![j] ?? 0) > 0 && (leader < 0 || hours[i]![j]! > hours[leader]![j]!)) leader = i;
    if (leader < 0) continue;
    const last = runs[runs.length - 1];
    if (last && last.artist === leader && last.last === j - 1) last.last = j;
    else runs.push({ artist: leader, first: j, last: j });
  }
  return runs.reduce<Run | null>((best, r) => (!best || r.last - r.first > best.last - best.first ? r : best), null);
}

function monthSpan(first: string, last: string): string {
  if (first === last) return fmtMonthLong(first);
  if (first.slice(0, 4) === last.slice(0, 4)) return `${fmtMonthLong(first).split(" ")[0]} to ${fmtMonthLong(last)}`;
  return `${fmtMonthLong(first)} to ${fmtMonthLong(last)}`;
}

/** Labels a month axis by year when it spans years, by month when it does not. */
function monthTick(months: string[], every: number) {
  const multiYear = months[0]!.slice(0, 4) !== months[months.length - 1]!.slice(0, 4) && months.length > 12;
  return {
    label: (j: number) => (multiYear ? months[j]!.slice(0, 4) : fmtMonthShort(months[j]!)),
    show: (j: number) => (multiYear ? months[j]!.endsWith("-01") : j % every === 0),
  };
}

function ErasChart({ eras, months, hours, pick, onPick }: { eras: Era[]; months: string[]; hours: number[][]; pick: Pick; onPick: (p: Pick) => void }) {
  const desktop = useDesktop();
  const cellLabel = (p: Pick) => `${eras[p.artist]!.artist}, ${fmtMonthLong(months[p.month]!)}: ${fmtHours(hours[p.artist]![p.month] ?? 0)}`;
  // Desktop: artists down, months across. Phone: months down, artists across by rank, so a cell stays tappable.
  if (desktop) {
    const tick = monthTick(months, 3);
    return (
      <DitherHeatmap
        label="Hours by artist and month. Arrow keys move the selection."
        values={hours}
        rowLabels={eras.map((e) => e.artist)}
        colLabels={months.map((_, j) => tick.label(j))}
        showCol={tick.show}
        cellLabel={({ row, col }) => cellLabel({ artist: row, month: col })}
        selected={{ row: pick.artist, col: pick.month }}
        onSelect={({ row, col }: HeatCell) => onPick({ artist: row, month: col })}
        cellHeight={24}
        rowLabelWidth={136}
      />
    );
  }
  const tick = monthTick(months, 2);
  return (
    <DitherHeatmap
      label="Hours by month and artist. Arrow keys move the selection."
      values={months.map((_, j) => hours.map((row) => row[j] ?? 0))}
      rowLabels={months.map((_, j) => tick.label(j))}
      showRow={tick.show}
      colLabels={eras.map((e) => <Artwork key={e.artist} src={e.imageUrl} kind="artist" box={24} className="mx-auto" />)}
      colLabelsAt="top"
      cellLabel={({ row, col }) => cellLabel({ artist: col, month: row })}
      selected={{ row: pick.month, col: pick.artist }}
      onSelect={({ row, col }: HeatCell) => onPick({ artist: col, month: row })}
      cellHeight={Math.round(Math.max(16, Math.min(44, 480 / months.length)))}
      rowLabelWidth={40}
    />
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="font-medium text-secondary">{title}</h3>
      {children}
    </div>
  );
}

function PickDetail({ era, month, hours, led }: { era: Era; month: string; hours: number; led: boolean }) {
  const scope = monthBounds(month);
  const page = useArtistPage(era.artist, scope, "month");
  const everyone = useTopArtists(scope, 5);
  const songs = page.data?.tracks.slice(0, 5);
  const songMax = songs?.[0]?.hours || 1;
  const artistMax = everyone.data?.items[0]?.hours || 1;
  return (
    <Section
      title={`${era.artist} in ${fmtMonthLong(month)}`}
      description={hours > 0 ? `${fmtHours(hours)}${led ? ", more than any other artist" : ""}` : undefined}
      labelledBy="eras-pick"
      actions={page.data && hours > 0 && <StartSessionButton uris={page.data.tracks.map((s) => s.uri)} />}
    >
      <div className="grid gap-8 xl:grid-cols-2">
        <Column title="Songs">
          {hours === 0 ? (
            <EmptyState size="inline" title={`No ${era.artist} this month`} />
          ) : page.isError ? (
            <ErrorState size="inline" error={page.error} onRetry={() => page.refetch()} />
          ) : !songs ? (
            <RowSkeleton rows={5} rank />
          ) : (
            <RowList label={`Top songs by ${era.artist}, ${fmtMonthLong(month)}`}>
              {songs.map((s, i) => (
                <TrackRow key={s.songKey} song={s} rank={i + 1} value={fmtHours(s.hours)} share={s.hours / songMax} />
              ))}
            </RowList>
          )}
        </Column>
        <Column title="Everyone that month">
          {everyone.isError ? (
            <ErrorState size="inline" error={everyone.error} onRetry={() => everyone.refetch()} />
          ) : !everyone.data ? (
            <RowSkeleton rows={5} rank />
          ) : (
            <RowList label={`Top artists, ${fmtMonthLong(month)}`}>
              {everyone.data.items.map((a, i) => (
                <ArtistRow key={a.artist} artist={a} rank={i + 1} value={fmtHours(a.hours)} share={a.hours / artistMax} />
              ))}
            </RowList>
          )}
        </Column>
      </div>
    </Section>
  );
}

function ErasView({ range }: { range: Range }) {
  const q = useEras(range, ARTISTS);
  const [picked, setPicked] = useState<Pick | null>(null);
  const data = q.data;
  const shape = useMemo(() => {
    if (!data || data.months.length === 0) return null;
    const start = leadInEnd(data.months.map((_, j) => data.series.reduce((sum, s) => sum + (s.hours[j] ?? 0), 0)));
    const months = data.months.slice(start);
    const hours = data.series.map((s) => s.hours.slice(start));
    const leftOut = data.series.reduce((sum, s) => sum + s.hours.slice(0, start).reduce((a, b) => a + b, 0), 0);
    return { months, hours, leftOut, run: longestRun(hours, months.length) };
  }, [data]);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!data)
    return (
      <div aria-busy className="flex flex-col gap-4">
        <Skeleton className="h-5 w-full max-w-md" />
        <ChartSkeleton shape="grid" phoneRows={24} className="h-[960px] md:h-[268px]" />
      </div>
    );
  if (!shape) return <EmptyState size="section" title="No plays in this range" description="Pick a wider range to see which artists defined each month." action={<RangePicker />} />;

  const { months, hours, leftOut, run } = shape;
  const eras = data.artists;
  const runPeak = run && hours[run.artist]!.reduce((best, v, j) => (j >= run.first && j <= run.last && v > hours[run.artist]![best]! ? j : best), run.first);
  const fallback = run && runPeak !== null ? { artist: run.artist, month: runPeak } : { artist: 0, month: months.length - 1 };
  const pick = picked && picked.artist < eras.length && picked.month < months.length ? picked : fallback;
  const pickedHours = hours[pick.artist]![pick.month] ?? 0;
  const led = pickedHours > 0 && hours.every((row) => (row[pick.month] ?? 0) <= pickedHours);
  const top = eras[0]?.hours || 1;

  return (
    <div className={cx(SECTIONS, dimWhile(q.isPlaceholderData))}>
      <div className="flex flex-col gap-4">
        {run && (
          <p className="text-body text-pretty">
            Longest era: <span className="font-medium">{eras[run.artist]!.artist}</span>, {monthSpan(months[run.first]!, months[run.last]!)}
            {run.last > run.first ? `, ${run.last - run.first + 1} months at the top.` : "."}
          </p>
        )}
        <ErasChart eras={eras} months={months} hours={hours} pick={pick} onPick={setPicked} />
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <HeatLegend />
          <DataTable
            label="Hours by artist and month"
            head={["Month", ...eras.map((e) => e.artist)]}
            rows={months.map((m, j) => ({ key: m, cells: [fmtMonth(m), ...hours.map((row) => fmtHoursValue(row[j] ?? 0))] }))}
          />
        </div>
        {leftOut > 0 && (
          <p className="text-caption text-secondary">
            Before {fmtMonthLong(months[0]!)} these artists add up to {fmtHours(leftOut)}, left out of the chart.
          </p>
        )}
      </div>
      <div className={SIDE_COLUMNS}>
        <PickDetail key={`${pick.artist}-${months[pick.month]}`} era={eras[pick.artist]!} month={months[pick.month]!} hours={pickedHours} led={led} />
        <Section title="Artists">
          <RowList label="Top artists in this range">
            {eras.map((e, i) => (
              <Row
                key={e.artist}
                to={artistPath(e.artist)}
                title={e.artist}
                subtitle={`Peak ${fmtMonth(e.peakMonth)}`}
                art={{ src: e.imageUrl, kind: "artist" }}
                rank={i + 1}
                value={fmtHours(e.hours)}
                share={e.hours / top}
              />
            ))}
          </RowList>
        </Section>
      </div>
    </div>
  );
}

export function Eras(): ReactNode {
  const { range } = useRange();
  return (
    <PatternsFrame icon={ChartBarIcon} firstUse="Once plays come in, this shows which artists defined each month.">
      <ErasView range={range} />
    </PatternsFrame>
  );
}
