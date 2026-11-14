import { useState } from "react";
import { useDigests, useLifetime, useOnThisDay, useOverview, usePicks, useRadar, useStatus, useTimeSeries, useTimezone, useTopAlbums, useTopArtists, useTopTracks } from "../api/queries";
import type { Overview as OverviewData, Status } from "../api/types";
import { songPath } from "../app/paths";
import { DitherArea } from "../charts/Dither";
import { periodTick, periodTitle } from "../charts/ticks";
import { addDays, daysBetween, todayIn } from "../lib/dates";
import { fmtAgo, fmtCompact, fmtDayShort, fmtHours, fmtHoursValue, fmtInt } from "../lib/format";
import { periodFor, useRange, type Range } from "../lib/range";
import { fillPeriods } from "../lib/series";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { buttonClass } from "../ui/Button";
import { Icon, type IconGlyph } from "../ui/Icon";
import { CaretRightIcon, NewspaperIcon, SparkleIcon, VinylRecordIcon, WaveformIcon } from "../ui/icons";
import { Page, PageHeader, SIDE_COLUMNS, Section, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { AlbumRow, ArtistRow, RowList, RowSkeleton, TrackRow } from "../ui/Rows";
import { TabList, TabPanel, TabsRoot } from "../ui/Segmented";
import { ChartSkeleton, Skeleton } from "../ui/Skeleton";
import { StatStrip, type StatItem } from "../ui/Stat";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { StartSessionButton } from "../ui/StartSessionButton";
import { Notice } from "../ui/Notice";
import { useDesktop } from "../lib/useMedia";

type Metric = "hours" | "plays" | "listens";

const METRIC_LABEL: Record<Metric, string> = { hours: "Hours", plays: "Plays", listens: "Listens" };

/** The range of the same length right before this one. All time has none. */
function previousRange(range: Range): Range | null {
  if (!range.from || !range.to) return null;
  const days = daysBetween(range.from, range.to);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

const change = (now: number, before: number | undefined) => (before === undefined || before === 0 ? null : (now - before) / before);

function figures(o: OverviewData, before: OverviewData | undefined): StatItem<Metric>[] {
  return [
    {
      id: "hours",
      label: "Time listened",
      value: fmtHoursValue(o.hours),
      unit: "hours",
      delta: change(o.hours, before?.hours),
      compare: before ? `from ${fmtHoursValue(before.hours)}` : undefined,
    },
    { id: "plays", label: "Plays", value: fmtCompact(o.plays), delta: change(o.plays, before?.plays), compare: before ? `from ${fmtCompact(before.plays)}` : undefined },
    {
      id: "listens",
      label: "Listens",
      value: fmtCompact(o.listens),
      delta: change(o.listens, before?.listens),
      compare: before ? `from ${fmtCompact(before.listens)}` : undefined,
    },
  ];
}

function Chart({ metric, range }: { metric: Metric; range: Range }) {
  const timezone = useTimezone();
  const today = todayIn(timezone);
  const lifetime = useLifetime();
  const desktop = useDesktop();
  const firstDay = lifetime.data?.firstPlayed?.slice(0, 10) ?? null;
  const period = periodFor(range, firstDay, today);
  const q = useTimeSeries(range, period);
  const height = desktop ? 260 : 180;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load the chart" />;
  if (!q.data) return <Skeleton className="w-full" style={{ height }} />;
  if (q.data.points.length === 0) return <EmptyState size="section" title="No plays in this range" />;
  const unit = q.data.period === "day" ? "per day" : q.data.period === "week" ? "per week" : "per month";
  const rows = fillPeriods(q.data.points, q.data.period, range, today, (p) => ({ period: p, hours: 0, plays: 0, listens: 0 })).map((p) => ({
    period: p.period,
    title: periodTitle(p.period, q.data.period),
    value: p[metric],
  }));
  return (
    <div className={dimWhile(q.isPlaceholderData)}>
      <DitherArea
        label={`${METRIC_LABEL[metric]} ${unit}`}
        rows={rows}
        xKey="period"
        tipLabel="title"
        valueKey="value"
        valueLabel={METRIC_LABEL[metric]}
        xFormat={(p) => periodTick(p, q.data.period)}
        format={metric === "hours" ? fmtHours : fmtInt}
        height={height}
      />
    </div>
  );
}

function Headline({ range }: { range: Range }) {
  const q = useOverview(range);
  const prev = previousRange(range);
  const before = useOverview(prev ?? range);
  const [metric, setMetric] = useState<Metric>("hours");
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div aria-busy className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2 md:flex md:gap-10">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2 pb-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
        <ChartSkeleton className="h-[180px] md:h-[260px]" />
      </div>
    );
  if (q.data.plays === 0)
    return <EmptyState size="section" title="No plays in this range" description="Pick a wider range to see your listening." action={<RangePicker />} />;
  const compare = prev && before.data && !before.isPlaceholderData ? before.data : undefined;
  return (
    <div className={dimWhile(q.isPlaceholderData)}>
      <StatStrip items={figures(q.data, compare)} value={metric} onChange={setMetric} label="Listening figures">
        <Chart metric={metric} range={range} />
      </StatStrip>
    </div>
  );
}

type TopTab = "artists" | "songs" | "albums";

function Top({ range, overview }: { range: Range; overview: OverviewData | undefined }) {
  const [tab, setTab] = useState<TopTab>("artists");
  const artists = useTopArtists(range, 10);
  const songs = useTopTracks(range, 10, {}, tab === "songs");
  const albums = useTopAlbums(range, 10);
  const q = tab === "artists" ? artists : tab === "songs" ? songs : albums;
  const items = q.data?.items ?? [];
  const max = items[0]?.hours || 1;
  const count = (n: number | undefined) => (n ? <span className="text-tertiary tabular max-md:hidden">{fmtCompact(n)}</span> : null);
  const allPath = `/music/${tab}`;
  return (
    <TabsRoot value={tab} onValueChange={(v) => setTab(v as TopTab)} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-4 hairline-b">
        <TabList
          label="Top in this range"
          options={[
            { value: "artists", label: <>Artists {count(overview?.uniqueArtists)}</> },
            { value: "songs", label: <>Songs {count(overview?.uniqueTracks)}</> },
            { value: "albums", label: "Albums" },
          ]}
        />
        <div className="flex shrink-0 items-center gap-2">
          {tab === "songs" && songs.data && <StartSessionButton uris={songs.data.items.map((s) => s.uri)} className="phone:hidden" />}
          <AppLink to={allPath} className={buttonClass({ variant: "ghost", size: "sm", className: "-mr-2.5" })}>
            Show all
          </AppLink>
        </div>
      </div>
      <TabPanel value={tab}>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <RowSkeleton rows={10} rank />
        ) : items.length === 0 ? (
          <EmptyState title={`No ${tab} in this range`} />
        ) : (
          <RowList label={`Top ${tab}`} className={dimWhile(q.isPlaceholderData)}>
            {tab === "artists" &&
              artists.data?.items.map((a, i) => <ArtistRow key={a.artist} artist={a} rank={i + 1} value={fmtHours(a.hours)} share={a.hours / max} subtitle={`${fmtInt(a.listens)} listens`} />)}
            {tab === "songs" && songs.data?.items.map((s, i) => <TrackRow key={s.songKey} song={s} rank={i + 1} value={fmtHours(s.hours)} share={s.hours / max} />)}
            {tab === "albums" && albums.data?.items.map((a, i) => <AlbumRow key={`${a.artist}|${a.album}`} album={a} rank={i + 1} value={fmtHours(a.hours)} share={a.hours / max} />)}
          </RowList>
        )}
      </TabPanel>
    </TabsRoot>
  );
}

function WaitingRow({ to, icon, title, detail }: { to: string; icon: IconGlyph; title: string; detail?: string }) {
  return (
    <li>
      <AppLink to={to} className="group -mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 transition-colors duration-150 hover:bg-fill">
        <Icon icon={icon} className="text-secondary" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{title}</span>
          {detail && <span className="truncate text-caption text-secondary">{detail}</span>}
        </span>
        <Icon icon={CaretRightIcon} className="text-tertiary" />
      </AppLink>
    </li>
  );
}

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** New since you last looked: this week's picks, releases from artists you play, the latest recap. Hidden when nothing waits. */
function Waiting() {
  const picks = usePicks();
  const radar = useRadar("new");
  const digests = useDigests();
  const newPicks = picks.data?.picks.filter((p) => p.state === "new").length ?? 0;
  const releases = radar.data?.unseenNew ?? 0;
  const recap = digests.data?.items[0];
  if (!newPicks && !releases && !recap) return null;
  return (
    <Section title="Waiting for you">
      <ul className="flex flex-col">
        {newPicks > 0 && <WaitingRow to="/for-you/picks" icon={SparkleIcon} title={plural(newPicks, "new pick", "new picks")} detail="This week, chosen by Claude" />}
        {releases > 0 && <WaitingRow to="/for-you/releases" icon={VinylRecordIcon} title={plural(releases, "new release", "new releases")} detail="From artists you play" />}
        {recap && <WaitingRow to={`/recaps/${recap.id}`} icon={NewspaperIcon} title={recap.title} detail={`${recap.kind === "weekly" ? "Weekly" : "Monthly"} recap, ${fmtAgo(recap.createdAt)}`} />}
      </ul>
    </Section>
  );
}

function OnThisDay() {
  const q = useOnThisDay();
  if (q.isError || !q.data || q.data.years.length === 0) return null;
  return (
    <Section title="On this day" description={`${fmtDayShort(q.data.date)} in earlier years`}>
      <ol className="flex flex-col">
        {q.data.years.map((y) => {
          const top = y.topTracks[0];
          return (
            <li key={y.year}>
              <AppLink
                to={top ? songPath(top.songKey) : "/plays"}
                className="-mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 transition-colors duration-150 hover:bg-fill"
              >
                <span className="w-10 shrink-0 text-secondary tabular">{y.year}</span>
                {top && <Artwork src={top.albumArtUrl} kind="song" box={32} />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{top?.name ?? "Listening"}</span>
                  <span className="truncate text-caption text-secondary">{top?.artist}</span>
                </span>
                <span className="shrink-0 text-secondary tabular">{fmtHours(y.hours)}</span>
              </AppLink>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

function problemOf(s: Status): string | null {
  if (!s.spotify.connected) return "Spotify is not connected, so new plays are not logged.";
  if (s.spotify.paused) return `Spotify calls are paused${s.spotify.paused.until ? ` until ${fmtAgo(s.spotify.paused.until)}` : ""}. New plays wait until then.`;
  if (s.poll.lastError) return `The last check for new plays failed: ${s.poll.lastError}`;
  return null;
}

function StatusNotice() {
  const q = useStatus();
  const problem = q.data ? problemOf(q.data) : null;
  if (!problem) return null;
  return (
    <Notice
      tone="warning"
      action={
        <AppLink to="/settings/spotify" className={buttonClass({ size: "sm" })}>
          Open Spotify settings
        </AppLink>
      }
    >
      {problem}
    </Notice>
  );
}

export function Overview() {
  const { range } = useRange();
  const lifetime = useLifetime();
  const overview = useOverview(range);
  const firstUse = lifetime.data?.plays === 0;
  return (
    <Page>
      <PageHeader title="Overview" actions={!firstUse && <RangePicker />} />
      {firstUse ? (
        <FirstUseState icon={WaveformIcon} description="Import your Spotify history or connect Spotify, and your listening shows here." />
      ) : (
        <>
          <StatusNotice />
          <Headline range={range} />
          <div className={SIDE_COLUMNS}>
            <Top range={range} overview={overview.data} />
            <div className="flex min-w-0 flex-col gap-10">
              <Waiting />
              <OnThisDay />
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
