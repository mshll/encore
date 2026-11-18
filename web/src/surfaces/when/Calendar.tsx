import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useCalendar, useTopTracks } from "../../api/queries";
import type { ListeningCalendar } from "../../api/types";
import { DataTable } from "../../charts/DataTable";
import { DitherHeatmap, HeatLegend } from "../../charts/DitherHeatmap";
import { InlineFact } from "../../charts/Inline";
import { addDays, weekStart } from "../../lib/dates";
import { fmtDay, fmtHours, fmtHoursValue, fmtInt, fmtMonthShort, WEEKDAYS, WEEKDAYS_SHORT } from "../../lib/format";
import { plural } from "../../lib/insights";
import { buttonClass } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Section, dimWhile } from "../../ui/Page";
import { RowList, RowSkeleton, TrackRow } from "../../ui/Rows";
import { Select } from "../../ui/Select";
import { ChartSkeleton } from "../../ui/Skeleton";
import { EmptyState, ErrorState } from "../../ui/States";

const WEEK_MS = 7 * 86_400_000;

type Day = ListeningCalendar["days"][number];

const weekdayOf = (day: string) => WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]!;
const dayTitle = (day: string) => `${weekdayOf(day)}, ${fmtDay(day)}`;

/** Weeks as columns from the Monday on or before 1 January, weekdays as rows; days outside the year are blank. */
function grid(year: number, days: Day[]) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const first = weekStart(`${year}-01-01`);
  const weekOf = (day: string) => Math.floor((Date.parse(day) - Date.parse(first)) / WEEK_MS);
  const weeks = weekOf(`${year}-12-31`) + 1;
  const dayAt = (row: number, col: number) => addDays(first, col * 7 + row);
  const inYear = (day: string) => day.startsWith(String(year));
  const values = Array.from({ length: 7 }, (_, r) => Array.from({ length: weeks }, (_, c) => byDay.get(dayAt(r, c))?.hours ?? 0));
  const monthOf = (col: number) => [0, 1, 2, 3, 4, 5, 6].map((r) => dayAt(r, col)).find(inYear)!.slice(0, 7);
  const colLabels = Array.from({ length: weeks }, (_, c) => (c === 0 || monthOf(c) !== monthOf(c - 1) ? fmtMonthShort(monthOf(c)) : ""));
  return { values, colLabels, dayAt, inYear, byDay, cellOf: (day: string) => ({ row: (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7, col: weekOf(day) }) };
}

function DayDetail({ day, info }: { day: string; info: Day | undefined }) {
  const songs = useTopTracks({ from: day, to: day }, 5, {}, Boolean(info));
  const max = songs.data?.items[0]?.hours || 1;
  return (
    <Section
      title={dayTitle(day)}
      description={info ? `${fmtHours(info.hours)} over ${plural(info.plays, "play", "plays")}` : undefined}
      labelledBy="when-day"
      actions={
        info && (
          <Link href={`/plays?from=${day}&to=${day}`} className={buttonClass({ variant: "ghost", size: "sm", className: "-mr-2.5" })}>
            Open in Plays
          </Link>
        )
      }
    >
      {!info ? (
        <EmptyState size="inline" title="No music this day" />
      ) : songs.isError ? (
        <ErrorState size="inline" error={songs.error} onRetry={() => songs.refetch()} />
      ) : !songs.data ? (
        <RowSkeleton rows={5} rank />
      ) : (
        <RowList label={`Top songs, ${dayTitle(day)}`} className={dimWhile(songs.isPlaceholderData)}>
          {songs.data.items.map((s, i) => (
            <TrackRow key={s.songKey} song={s} rank={i + 1} value={fmtHours(s.hours)} share={s.hours / max} />
          ))}
        </RowList>
      )}
    </Section>
  );
}

function CalendarGrid({ data, year }: { data: ListeningCalendar; year: number }) {
  const g = useMemo(() => grid(year, data.days), [year, data.days]);
  const busiest = data.days.reduce<Day | undefined>((best, d) => (!best || d.hours > best.hours ? d : best), undefined);
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked && g.inYear(picked) ? picked : (busiest?.day ?? `${year}-01-01`);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [year]);

  return (
    <div className="flex flex-col gap-4">
      {busiest && (
        <InlineFact label="Busiest day" figure={fmtHours(busiest.hours)}>
          {dayTitle(busiest.day)}
        </InlineFact>
      )}
      <div ref={scroller} className="-mx-(--gutter) overflow-x-auto overscroll-x-contain px-(--gutter) [scrollbar-width:none]">
        <div className="min-w-[44rem]">
          <DitherHeatmap
            label={`Hours each day of ${year}. Arrow keys move the selection.`}
            values={g.values}
            rowLabels={WEEKDAYS_SHORT}
            showRow={(r) => r % 2 === 0}
            colLabels={g.colLabels}
            showCol={(c) => g.colLabels[c] !== ""}
            blank={({ row, col }) => !g.inYear(g.dayAt(row, col))}
            cellLabel={({ row, col }) => {
              const d = g.dayAt(row, col);
              const info = g.byDay.get(d);
              return `${dayTitle(d)}: ${info ? `${fmtHours(info.hours)}, ${plural(info.plays, "play", "plays")}` : "no music"}`;
            }}
            selected={g.cellOf(day)}
            onSelect={({ row, col }) => setPicked(g.dayAt(row, col))}
            cellHeight={16}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <HeatLegend />
        <DataTable label={`Listening each day of ${year}`} head={["Day", "Hours", "Plays"]} rows={data.days.map((d) => ({ key: d.day, cells: [d.day, fmtHoursValue(d.hours), fmtInt(d.plays)] }))} />
      </div>
      <DayDetail day={day} info={g.byDay.get(day)} />
    </div>
  );
}

/** One cell per day of a year, shaded by hours; a day opens what was played. The year is its own control: the page's range does not apply. */
export function CalendarSection() {
  const [year, setYear] = useState<number | null>(null);
  const q = useCalendar(year);
  const shown = q.data?.year ?? null;
  if (q.data && q.data.years.length === 0) return null;
  return (
    <Section
      title={shown ? `Every day of ${shown}` : "Every day"}
      labelledBy="when-calendar"
      actions={
        q.data &&
        shown !== null && (
          <Select
            label="Year"
            value={String(shown)}
            onChange={(v) => setYear(Number(v))}
            options={[...q.data.years].reverse().map((y) => ({ value: String(y), label: String(y) }))}
          />
        )
      }
    >
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || shown === null ? (
        <ChartSkeleton shape="grid" className="h-[146px]" />
      ) : (
        <div className={cx(dimWhile(q.isPlaceholderData))}>
          {q.data.days.length === 0 ? <EmptyState size="inline" title={`No music in ${shown}`} /> : <CalendarGrid key={shown} data={q.data} year={shown} />}
        </div>
      )}
    </Section>
  );
}
