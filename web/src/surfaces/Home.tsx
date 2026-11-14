import { useState } from "react";
import { useLocation } from "wouter";
import {
  useDigests,
  useLifetime,
  useLiving,
  useOnThisDay,
  useOverview,
  usePicks,
  useRadar,
  useSets,
  useStatus,
  useTimeSeries,
  useTimezone,
  useTopAlbums,
  useTopArtists,
  useTopTracks,
} from "../api/queries";
import type { Overview as OverviewData, Status } from "../api/types";
import { songPath } from "../app/paths";
import { DitherArea } from "../charts/Dither";
import { periodTick, periodTitle } from "../charts/ticks";
import { addDays, daysBetween, todayIn } from "../lib/dates";
import { fmtAgo, fmtCompact, fmtDay, fmtDayShort, fmtHour, fmtHours, fmtHoursValue, fmtInt, WEEKDAYS } from "../lib/format";
import { periodFor, useRange, type Range } from "../lib/range";
import { fillPeriods } from "../lib/series";
import { useDesktop } from "../lib/useMedia";
import { usePlayback } from "../player/playback";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { buttonClass, IconButton } from "../ui/Button";
import { useClaudeGate } from "../ui/ClaudeNotice";
import { Composer } from "../ui/Composer";
import { PlayIcon, WaveformIcon } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { Page, PageHeader, SIDE_COLUMNS, Section, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { AlbumRow, ArtistRow, RowList, RowSkeleton, TrackRow } from "../ui/Rows";
import { Segmented, TabList, TabPanel, TabsRoot } from "../ui/Segmented";
import { ChartSkeleton, Skeleton } from "../ui/Skeleton";
import { StatStrip, type StatItem } from "../ui/Stat";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { StartSessionButton } from "../ui/StartSessionButton";
import { CoversSkeleton, PlaylistCovers } from "./Playlists";

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
  const height = desktop ? 180 : 140;
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
        <ChartSkeleton className="h-[140px] md:h-[180px]" />
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

/** This week's picks, three of them with Claude's reason. The rest, the keep and never actions and the run live on Weekly picks. */
function WeekPicks() {
  const q = usePicks();
  const status = useStatus();
  const gate = useClaudeGate({ needsSpotify: true });
  const playback = usePlayback();
  const picks = q.data?.picks ?? [];
  const schedule = status.data?.llm.schedule;
  return (
    <Section
      title="This week’s picks"
      description={picks.length > 0 ? `${plural(picks.length, "song", "songs")} new to you, chosen by Claude` : undefined}
      actions={
        <AppLink to="/for-you/picks" className={buttonClass({ variant: "ghost", size: "sm", className: "-mr-2.5" })}>
          {picks.length > 3 ? "Show all" : "Open"}
        </AppLink>
      }
    >
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={3} />
      ) : picks.length === 0 ? (
        <p className="text-secondary text-pretty">
          {gate.blocked ?? (schedule?.enabled ? `No picks yet this week. Claude picks them on ${WEEKDAYS[schedule.picks.weekday - 1]} at ${fmtHour(schedule.picks.hour)}.` : "No picks yet this week.")}
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {picks.slice(0, 3).map((p) => (
            <li key={p.id} className="group -mx-2 flex gap-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-fill">
              <Artwork src={p.albumArtUrl} kind="song" box={48} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-primary">{p.name}</span>
                <span className="truncate text-caption text-secondary">{p.artist}</span>
                <span className="mt-1 line-clamp-2 text-caption text-pretty text-secondary">{p.reason}</span>
              </span>
              <IconButton icon={PlayIcon} label={`Play ${p.name}`} size="sm" onClick={() => playback.play([p.uri])} />
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function SideRow({ to, art, kind, title, detail }: { to: string; art: string | null; kind: "album" | "playlist"; title: string; detail: string }) {
  return (
    <li>
      <AppLink to={to} className="-mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-fill">
        <Artwork src={art} kind={kind} box={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-primary">{title}</span>
          <span className="truncate text-caption text-secondary">{detail}</span>
        </span>
      </AppLink>
    </li>
  );
}

/** New releases not yet seen, the latest set and the latest recap: each only when there is one. */
function Lately() {
  const radar = useRadar("new");
  const sets = useSets();
  const digests = useDigests();
  const releases = (radar.data?.items ?? []).filter((r) => !r.seen).slice(0, 3);
  const set = sets.data?.items[0];
  const recap = digests.data?.items[0];
  return (
    <>
      {releases.length > 0 && (
        <Section
          title="New releases"
          actions={
            <AppLink to="/for-you/new-releases" className={buttonClass({ variant: "ghost", size: "sm", className: "-mr-2.5" })}>
              Show all
            </AppLink>
          }
        >
          <ul className="flex flex-col">
            {releases.map((r) => (
              <SideRow key={r.id} to="/for-you/new-releases" art={r.imageUrl} kind="album" title={r.name} detail={`${r.artist} · ${fmtDay(r.releaseDate)}`} />
            ))}
          </ul>
        </Section>
      )}
      {set && (
        <Section title="Latest set">
          <ul className="flex flex-col">
            <SideRow
              to={`/sets/${set.id}`}
              art={set.coverUrl}
              kind="playlist"
              title={set.title}
              detail={[set.version === 0 ? "Waiting for your answer" : plural(set.tracks, "song", "songs"), fmtAgo(set.updatedAt)].join(" · ")}
            />
          </ul>
        </Section>
      )}
      {recap && (
        <Section title="Latest recap">
          <AppLink to={`/recaps/${recap.id}`} className="-mx-2 flex flex-col rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-fill">
            <span className="truncate text-primary">{recap.title}</span>
            <span className="truncate text-caption text-secondary">{`${recap.kind === "weekly" ? "Weekly" : "Monthly"} recap, ${fmtAgo(recap.createdAt)}`}</span>
          </AppLink>
        </Section>
      )}
    </>
  );
}

/** The playlists encore keeps, by cover. Hidden until the list loads; a failed load says so with Try again. */
function MadeForYou() {
  const q = useLiving();
  return (
    <Section
      title="Made for you"
      actions={
        <AppLink to="/for-you" className={buttonClass({ variant: "ghost", size: "sm", className: "-mr-2.5" })}>
          Open For you
        </AppLink>
      }
    >
      {q.isError ? <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <CoversSkeleton /> : <PlaylistCovers list={q.data} shelf />}
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

/**
 * Home: what to listen to now and what is new, first (the playlists encore keeps, this week's picks, new releases, the
 * latest set, one composer for Ask or Sets); how the owner has been listening, second, compact (Music and Patterns hold
 * the full answers).
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
          description="Import your Spotify history or connect Spotify. Then Home fills with playlists made from your listening, Claude’s picks for the week, and how you have been listening."
        />
      ) : (
        <>
          <StatusNotice />
          <MadeForYou />
          <div className={SIDE_COLUMNS}>
            <div className="flex min-w-0 flex-col gap-10">
              <AskOrSet />
              <WeekPicks />
            </div>
            <div className="flex min-w-0 flex-col gap-10">
              <Lately />
            </div>
          </div>
          <Section labelledBy="listening-title" title="Your listening" actions={<RangePicker />}>
            <div className="flex flex-col gap-10">
              <Headline range={range} />
              <div className={SIDE_COLUMNS}>
                <Top range={range} overview={overview.data} />
                <OnThisDay />
              </div>
            </div>
          </Section>
        </>
      )}
    </Page>
  );
}
