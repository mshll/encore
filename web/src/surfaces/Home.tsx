import { useState } from "react";
import { useLocation } from "wouter";
import { useDigests, useLifetime, useLiving, useOnThisDay, useOverview, useStatus, useTimeSeries, useTimezone, useTopAlbums, useTopArtists, useTopTracks, useWeek } from "../api/queries";
import type { Overview as OverviewData, Status, WeekSoFar } from "../api/types";
import { artistPath, recapPath, songPath } from "../app/paths";
import { DitherArea, DitherBars } from "../charts/Dither";
import { InlineChange, InlinePair } from "../charts/Inline";
import { periodTick, periodTitle } from "../charts/ticks";
import { todayIn } from "../lib/dates";
import { fmtAgo, fmtCompact, fmtDayShort, fmtHours, fmtHoursValue, fmtInt, hoursParts, WEEKDAYS_SHORT } from "../lib/format";
import { periodFor, useRange, type Range } from "../lib/range";
import { fillPeriods } from "../lib/series";
import { useDesktop } from "../lib/useMedia";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { buttonClass } from "../ui/Button";
import { useClaudeGate } from "../ui/ClaudeNotice";
import { Composer } from "../ui/Composer";
import { WaveformIcon } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { Page, PageHeader, SIDE_COLUMNS, Section, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { AlbumRow, ArtistRow, Row, RowList, RowSkeleton, TrackRow } from "../ui/Rows";
import { Segmented, TabList, TabPanel, TabsRoot } from "../ui/Segmented";
import { ChartSkeleton, Skeleton } from "../ui/Skeleton";
import { StatStrip, type StatItem } from "../ui/Stat";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { StartSessionButton } from "../ui/StartSessionButton";
import { PlaylistRows, PlaylistRowsSkeleton } from "./Playlists";

const weekdayShort = (day: string) => WEEKDAYS_SHORT[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]!;
const shortHours = (h: number) => (h * 60 < 60 ? `${Math.round(h * 60)} min` : `${fmtHoursValue(h)} h`);
const hoursText = (h: number) => {
  const p = hoursParts(h);
  return `${p.value} ${p.unit}`;
};

/** This week so far against the usual, then each of the last 30 days. */
function WeekLine({ week }: { week: WeekSoFar }) {
  const { usual } = week;
  if (week.hours === 0)
    return <p className="text-secondary text-pretty">{usual && usual.hours > 0 ? `Nothing played yet. By now you usually have ${shortHours(usual.hours)}.` : "Nothing played yet."}</p>;
  if (!usual) return <p className="text-secondary">{plural(week.listens, "play", "plays")}</p>;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-primary">
      <InlinePair now={week.hours} before={usual.hours} label={`${hoursText(week.hours)}, against a usual ${hoursText(usual.hours)} by now`} />
      <InlineChange now={week.hours} before={usual.hours} />
      <span className="min-w-0 text-secondary">against a usual {shortHours(usual.hours)} by now</span>
    </p>
  );
}

function WeekChart({ days }: { days: WeekSoFar["days"] }) {
  const desktop = useDesktop();
  return (
    <DitherBars
      label="Hours each day, the last 30 days"
      rows={days.map((d) => ({ day: d.day, title: fmtDayShort(d.day), hours: d.hours }))}
      xKey="day"
      tipLabel="title"
      valueKey="hours"
      valueLabel="Hours"
      xFormat={(d) => fmtDayShort(d)}
      format={fmtHours}
      height={desktop ? 120 : 96}
    />
  );
}

function WeekTop({ week }: { week: WeekSoFar }) {
  const { topArtist: artist, topTrack: song } = week;
  if (!artist && !song) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="font-medium text-primary">Top this week</h3>
      <RowList label="Top this week">
        {artist && <Row to={artistPath(artist.artist)} title={artist.artist} subtitle={plural(artist.listens, "play", "plays")} art={{ src: artist.imageUrl, kind: "artist" }} value={fmtHours(artist.hours)} />}
        {song && (
          <Row
            to={songPath(song.songKey)}
            title={song.name}
            subtitle={song.artist}
            art={{ src: song.albumArtUrl, kind: "song" }}
            value={fmtHours(song.hours)}
            song={{ uri: song.uri, name: song.name, songKey: song.songKey, artist: song.artist }}
          />
        )}
      </RowList>
    </div>
  );
}

/** How much the owner listened this week against their usual: it leads Home because it changes every day. */
function ThisWeek() {
  const q = useWeek();
  const week = q.data;
  return (
    <Section title="This week" description={week ? `${weekdayShort(week.from)} ${fmtDayShort(week.from)} – ${weekdayShort(week.to)} ${fmtDayShort(week.to)}` : undefined}>
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !week ? (
        <div aria-busy className={SIDE_COLUMNS}>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-64" />
            <ChartSkeleton className="h-[96px] md:h-[120px]" />
          </div>
          <RowSkeleton rows={2} />
        </div>
      ) : (
        <div className={SIDE_COLUMNS}>
          <div className="flex min-w-0 flex-col gap-3">
            <p className="flex items-baseline gap-1.5">
              <span className="font-display text-figure text-primary tabular">{hoursParts(week.hours).value}</span>
              <span className="text-secondary">{hoursParts(week.hours).unit}</span>
            </p>
            <WeekLine week={week} />
            <WeekChart days={week.days} />
          </div>
          <WeekTop week={week} />
        </div>
      )}
    </Section>
  );
}

type Metric = "hours" | "plays" | "listens";

const METRIC_LABEL: Record<Metric, string> = { hours: "Hours", plays: "Plays", listens: "Listens" };

const ALL_TIME: Range = {};

function totals(o: OverviewData): StatItem<Metric>[] {
  return [
    { id: "hours", label: "Hours", value: fmtHoursValue(o.hours) },
    { id: "plays", label: "Plays", value: fmtCompact(o.plays) },
    { id: "listens", label: "Listens", value: fmtCompact(o.listens) },
  ];
}

function AllTimeChart({ metric, firstDay }: { metric: Metric; firstDay: string | null }) {
  const today = todayIn(useTimezone());
  const desktop = useDesktop();
  const q = useTimeSeries(ALL_TIME, periodFor(ALL_TIME, firstDay, today));
  if (q.isError) return <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} title="Could not load the chart" />;
  if (!q.data) return <ChartSkeleton className="h-[96px] md:h-[120px]" />;
  if (q.data.points.length === 0) return <EmptyState size="section" title="No plays yet" />;
  const period = q.data.period;
  const unit = period === "day" ? "per day" : period === "week" ? "per week" : "per month";
  const rows = fillPeriods(q.data.points, period, ALL_TIME, today, (p) => ({ period: p, hours: 0, plays: 0, listens: 0 })).map((p) => ({
    period: p.period,
    title: periodTitle(p.period, period),
    value: p[metric],
  }));
  return (
    <DitherArea
      label={`${METRIC_LABEL[metric]} ${unit}, all time`}
      rows={rows}
      xKey="period"
      tipLabel="title"
      valueKey="value"
      valueLabel={METRIC_LABEL[metric]}
      xFormat={(p) => periodTick(p, period)}
      format={metric === "hours" ? fmtHours : fmtInt}
      height={desktop ? 120 : 96}
    />
  );
}

function OnThisDay() {
  const q = useOnThisDay();
  if (q.data?.years.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="font-medium text-primary">On this day</h3>
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={3} />
      ) : (
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
      )}
    </div>
  );
}

/** The long view under This week, laid out the same: the totals drive the chart of every month, this day in earlier years beside it. */
function AllTime() {
  const q = useLifetime();
  const [metric, setMetric] = useState<Metric>("hours");
  return (
    <Section title="All time">
      <div className={SIDE_COLUMNS}>
        <div className="min-w-0">
          {q.isError ? (
            <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data ? (
            <div aria-busy className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-2 md:flex md:gap-10">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex flex-col gap-2 pb-3">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-8 w-24" />
                  </div>
                ))}
              </div>
              <ChartSkeleton className="h-[96px] md:h-[120px]" />
            </div>
          ) : (
            <StatStrip items={totals(q.data)} value={metric} onChange={setMetric} label="All-time figures">
              <AllTimeChart metric={metric} firstDay={q.data.firstPlayed?.slice(0, 10) ?? null} />
            </StatStrip>
          )}
        </div>
        <OnThisDay />
      </div>
    </Section>
  );
}

type TopTab = "artists" | "songs" | "albums";

function Top({ range, overview }: { range: Range; overview: OverviewData | undefined }) {
  const [tab, setTab] = useState<TopTab>("artists");
  const artists = useTopArtists(range, 5);
  const songs = useTopTracks(range, 5, {}, tab === "songs");
  const albums = useTopAlbums(range, 5);
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
          <RowSkeleton rows={5} rank />
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

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** One composer that routes to Ask or Sets: the page there starts the run, so its progress and result live where they belong. */
function AskOrSet() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"ask" | "set">("ask");
  const gate = useClaudeGate({ needsSpotify: mode === "set" });
  const [, navigate] = useLocation();
  const go = () => navigate(`${mode === "ask" ? "/ask" : "/sets"}?q=${encodeURIComponent(text.trim())}`);
  return (
    <Composer
      label={mode === "ask" ? "Ask about your listening" : "Describe a set"}
      placeholder={mode === "ask" ? "Why did I stop playing…, what do I play when…" : "A late drive home, songs I finished at night, a few I’ve never heard"}
      value={text}
      onChange={setText}
      onSubmit={go}
      maxLength={mode === "ask" ? 1000 : 2000}
      disabled={Boolean(gate.blocked)}
      notice={gate.blocked ?? (mode === "set" ? gate.warning : null)}
      footer={
        <span className="flex items-center gap-3">
          <span className="w-44 shrink-0">
            <Segmented
              label="Send to"
              value={mode}
              onChange={setMode}
              options={[
                { value: "ask", label: "Ask" },
                { value: "set", label: "Make a set" },
              ]}
            />
          </span>
          {gate.spend && <span className="truncate phone:hidden">{gate.spend}</span>}
        </span>
      }
    />
  );
}

/** The playlists encore keeps, small: what is new in each (picks, releases) is its line. */
function MadeForYou() {
  const q = useLiving();
  return (
    <section aria-labelledby="made-for-you" className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <h2 id="made-for-you" className="font-medium text-secondary">
          Made for you
        </h2>
        <AppLink to="/for-you" className={buttonClass({ variant: "ghost", size: "sm", className: "-mr-2.5" })}>
          Open For you
        </AppLink>
      </div>
      {q.isError ? <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <PlaylistRowsSkeleton /> : <PlaylistRows list={q.data} />}
    </section>
  );
}

function LatestRecap() {
  const q = useDigests();
  const recap = q.data?.items[0];
  if (!recap) return null;
  return (
    <AppLink to={recapPath(recap.kind, recap.periodKey)} className="-mx-2 flex min-h-(--row-h) flex-col justify-center rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-fill">
      <span className="truncate text-primary">{recap.headline}</span>
      <span className="truncate text-caption text-secondary">{`${recap.title} · ${fmtAgo(recap.createdAt)}`}</span>
    </AppLink>
  );
}

/** What to play next, after the stats: the playlists, one composer for Ask or Sets, the latest recap. */
function PlayNext() {
  return (
    <div className={SIDE_COLUMNS}>
      <MadeForYou />
      <div className="flex min-w-0 flex-col gap-3">
        <AskOrSet />
        <LatestRecap />
      </div>
    </div>
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

/**
 * Home: the stats first. This week against the usual, then All time laid out the same way (the long view under the
 * short one), then the top lists for any range. What to play next follows, quieter: the playlists, the composer for
 * Ask or Sets, the latest recap. Music and Patterns hold the full answers.
 */
export function Home() {
  const { range } = useRange();
  const lifetime = useLifetime();
  const overview = useOverview(range);
  const firstUse = lifetime.data?.plays === 0;
  return (
    <Page>
      <PageHeader title="Home" />
      {firstUse ? (
        <FirstUseState
          icon={WaveformIcon}
          description="Import your Spotify history or connect Spotify. Then Home shows how much you listen each week and over the years, and playlists made from your listening."
        />
      ) : (
        <>
          <StatusNotice />
          <ThisWeek />
          <AllTime />
          <Section title="Most played" description={overview.data && overview.data.plays > 0 ? `${hoursText(overview.data.hours)}, ${plural(overview.data.listens, "play", "plays")}` : undefined} actions={<RangePicker />}>
            <Top range={range} overview={overview.data} />
          </Section>
          <PlayNext />
        </>
      )}
    </Page>
  );
}
