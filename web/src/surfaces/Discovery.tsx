import { useState, type ReactNode } from "react";
import { useComebacks, useDiscovery, useLoyalty, useMonthDiscoveries } from "../api/queries";
import type { Discovery as DiscoveryData, Loyalty, MonthDiscovery } from "../api/types";
import { artistPath, songPath } from "../app/paths";
import { DitherBars } from "../charts/Dither";
import { InlineColumns, InlineFact } from "../charts/Inline";
import { ditherTile, TILE_STYLE } from "../charts/ditherTile";
import { periodTick } from "../charts/ticks";
import { addMonths, monthSequence } from "../lib/dates";
import { fmtDay, fmtDayShort, fmtHours, fmtInt, fmtMonth, fmtMonthLong, fmtPct } from "../lib/format";
import { plural } from "../lib/insights";
import { leadInEnd } from "../lib/leadIn";
import { useRange, type Range } from "../lib/range";
import { useDesktop } from "../lib/useMedia";
import { cx } from "../ui/cx";
import { CompassIcon } from "../ui/icons";
import { SECTIONS, SIDE_COLUMNS, Section, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { Row, RowList, RowSkeleton } from "../ui/Rows";
import { Select } from "../ui/Select";
import { ChartSkeleton, Skeleton } from "../ui/Skeleton";
import { StatStrip, type StatItem } from "../ui/Stat";
import { EmptyState, ErrorState } from "../ui/States";
import { PatternsFrame } from "./PatternsFrame";

type Metric = "artists" | "songs" | "share";

const METRIC: Record<Metric, { label: string; value: (m: MonthDiscovery) => number; format: (v: number) => string; most: string }> = {
  artists: { label: "New artists", value: (m) => m.newArtists, format: fmtInt, most: "Most new artists" },
  songs: { label: "New songs", value: (m) => m.newSongs, format: fmtInt, most: "Most new songs" },
  share: { label: "Time on new songs", value: (m) => Math.round((m.newShare ?? 0) * 1000) / 10, format: (v) => `${Math.round(v)}%`, most: "Most time on new songs" },
};

/** Every month from the first to the last, with zeros where nothing played, after a long quiet lead-in; `cut` says whether one was left out. */
function filled(months: MonthDiscovery[]): { months: MonthDiscovery[]; cut: boolean } {
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const all = monthSequence(months[0]!.month, months.at(-1)!.month).map((month) => byMonth.get(month) ?? { month, hours: 0, newHours: 0, newShare: null, newArtists: 0, newSongs: 0 });
  const start = leadInEnd(all.map((m) => m.hours));
  return { months: all.slice(start), cut: start > 0 };
}

function MonthChart({ months, cut, metric }: { months: MonthDiscovery[]; cut: boolean; metric: Metric }) {
  const desktop = useDesktop();
  const m = METRIC[metric];
  const peak = months.reduce((best, x) => (m.value(x) > m.value(best) ? x : best), months[0]!);
  const values = months.map(m.value);
  return (
    <div className="flex flex-col gap-4 pt-5">
      <InlineFact
        label={m.most}
        figure={m.format(m.value(peak))}
        mark={<InlineColumns values={values} mark={months.indexOf(peak)} label={`${m.label} each month; the most in ${fmtMonthLong(peak.month)}`} />}
      >
        {fmtMonthLong(peak.month)}
      </InlineFact>
      <DitherBars
        label={`${m.label} each month`}
        rows={months.map((x) => ({ month: x.month, title: fmtMonth(x.month), value: m.value(x) }))}
        xKey="month"
        tipLabel="title"
        valueKey="value"
        valueLabel={m.label}
        xFormat={(p) => periodTick(p, "month")}
        format={m.format}
        table={metric === "share" ? { format: (v) => String(Math.round(v)), unit: "%" } : undefined}
        height={desktop ? 200 : 160}
      />
      {cut && <p className="text-caption text-secondary">Starts {fmtMonthLong(months[0]!.month)}; the quiet months before it are left out.</p>}
    </div>
  );
}

function MonthFinds({ months }: { months: MonthDiscovery[] }) {
  const options = [...months].reverse().filter((m) => m.newArtists + m.newSongs > 0);
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked && options.some((o) => o.month === picked) ? picked : (options[0]?.month ?? null);
  const q = useMonthDiscoveries(month);
  if (!month) return null;
  return (
    <Section
      title={`New in ${fmtMonthLong(month)}`}
      description="First played that month, by hours that month"
      labelledBy="discovery-month"
      actions={<Select label="Month" value={month} onChange={setPicked} options={options.map((o) => ({ value: o.month, label: fmtMonthLong(o.month) }))} />}
    >
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={6} />
      ) : (
        <div className={cx("grid gap-8 xl:grid-cols-2", dimWhile(q.isPlaceholderData))}>
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="font-medium text-secondary">Songs</h3>
            {q.data.songs.length === 0 ? (
              <EmptyState size="inline" title="No new songs that month" />
            ) : (
              <RowList label={`New songs, ${fmtMonthLong(month)}`}>
                {q.data.songs.map((s) => (
                  <Row
                    key={s.songKey}
                    to={songPath(s.songKey)}
                    title={s.name}
                    subtitle={`${s.artist} · first ${fmtDayShort(s.firstDay)}`}
                    art={{ src: s.albumArtUrl, kind: "song" }}
                    value={fmtHours(s.hours)}
                    song={{ uri: s.uri, name: s.name, songKey: s.songKey, artist: s.artist }}
                  />
                ))}
              </RowList>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="font-medium text-secondary">Artists</h3>
            {q.data.artists.length === 0 ? (
              <EmptyState size="inline" title="No new artists that month" />
            ) : (
              <RowList label={`New artists, ${fmtMonthLong(month)}`}>
                {q.data.artists.map((a) => (
                  <Row
                    key={a.artist}
                    to={artistPath(a.artist)}
                    title={a.artist}
                    subtitle={`${plural(a.songs, "song", "songs")} · first ${fmtDayShort(a.firstDay)}`}
                    art={{ src: a.imageUrl, kind: "artist" }}
                    value={fmtHours(a.hours)}
                  />
                ))}
              </RowList>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function ComebackList({ range }: { range: Range }) {
  const q = useComebacks(range);
  return (
    <Section title="Comebacks" description="Back after six months or more away, with the hours since" labelledBy="discovery-comebacks">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={4} />
      ) : q.data.items.length === 0 ? (
        <EmptyState size="inline" title="No comebacks in this range" />
      ) : (
        <RowList label="Comebacks" className={dimWhile(q.isPlaceholderData)}>
          {q.data.items.map((c) => (
            <Row
              key={`${c.artist}|${c.returned}`}
              to={artistPath(c.artist)}
              title={c.artist}
              art={{ src: c.imageUrl, kind: "artist" }}
              subtitle={`Back ${fmtDay(c.returned)} after ${plural(c.gapMonths, "month", "months")}`}
              value={fmtHours(c.hoursSince)}
            />
          ))}
        </RowList>
      )}
    </Section>
  );
}

/** One cell per year with music in the range; a lit cell is a loyal year. */
function YearStrip({ years, loyal }: { years: number[]; loyal: number[] }) {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {years.map((y) => (
        <span
          key={y}
          title={String(y)}
          className={cx("h-2 w-3 rounded-[1px]", !loyal.includes(y) && "bg-chart-empty")}
          style={loyal.includes(y) ? { ...TILE_STYLE, backgroundImage: ditherTile(16) } : undefined}
        />
      ))}
    </span>
  );
}

function runText(item: Loyalty["items"][number]): string {
  const { run } = item;
  return run.years > 1 ? `${run.from}–${run.to} in a row` : item.years.join(", ");
}

function LoyaltyList({ range }: { range: Range }) {
  const q = useLoyalty(range);
  return (
    <Section title="Loyal artists" description="Years with 2 hours or more of them" labelledBy="discovery-loyalty">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={5} />
      ) : q.data.items.length === 0 ? (
        <EmptyState size="inline" title="No artist reached two years in this range" />
      ) : (
        <RowList label="Loyal artists" className={dimWhile(q.isPlaceholderData)}>
          {q.data.items.map((a) => (
            <Row
              key={a.artist}
              to={artistPath(a.artist)}
              title={a.artist}
              subtitle={
                <span className="flex items-center gap-2" aria-label={`Loyal in ${a.years.join(", ")}`}>
                  <YearStrip years={q.data.years} loyal={a.years} />
                  <span className="truncate">{runText(a)}</span>
                </span>
              }
              art={{ src: a.imageUrl, kind: "artist" }}
              value={plural(a.years.length, "year", "years")}
            />
          ))}
        </RowList>
      )}
    </Section>
  );
}

function figures(d: DiscoveryData): StatItem<Metric>[] {
  return [
    { id: "artists", label: "New artists", value: fmtInt(d.totals.newArtists) },
    { id: "songs", label: "New songs", value: fmtInt(d.totals.newSongs) },
    { id: "share", label: "On new songs", value: fmtPct(d.totals.newShare) },
  ];
}

function DiscoveryView({ range }: { range: Range }) {
  const q = useDiscovery(range);
  const [metric, setMetric] = useState<Metric>("artists");
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div aria-busy className="flex flex-col gap-6">
        <div className="flex gap-10">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2 pb-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <ChartSkeleton className="h-[160px] md:h-[200px]" />
      </div>
    );
  const { months, historyStart } = q.data;
  if (months.length === 0)
    return (
      <EmptyState
        size="section"
        title="No months to count in this range"
        description={historyStart ? `New music counts from ${fmtMonthLong(addMonths(historyStart, 1).slice(0, 7))}, the month after your history starts.` : undefined}
        action={<RangePicker />}
      />
    );
  const series = filled(months);

  return (
    <div className={cx(SECTIONS, dimWhile(q.isPlaceholderData))}>
      <StatStrip items={figures(q.data)} value={metric} onChange={setMetric} label="Discovery figures">
        <MonthChart months={series.months} cut={series.cut} metric={metric} />
      </StatStrip>
      <MonthFinds months={months} />
      <div className={SIDE_COLUMNS}>
        <LoyaltyList range={range} />
        <ComebackList range={range} />
      </div>
    </div>
  );
}

export function Discovery(): ReactNode {
  const { range } = useRange();
  return (
    <PatternsFrame icon={CompassIcon} firstUse="Once plays come in, this shows the artists and songs you find each month and the ones you come back to.">
      <DiscoveryView range={range} />
    </PatternsFrame>
  );
}
