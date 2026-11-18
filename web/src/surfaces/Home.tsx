import type { UseQueryResult } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  useLifetime,
  useLiving,
  useMoments,
  useOnRepeat,
  useOnThisDay,
  useOverview,
  usePlayerNow,
  useRecentPlays,
  useStatus,
  useTimeSeries,
  useTimezone,
  useTopArtists,
  useTopTracks,
  useWeek,
} from "../api/queries";
import type { LivingKind, Moment, Overview as OverviewData, Status, WeekSoFar } from "../api/types";
import { artistPath, recapPath, songPath } from "../app/paths";
import { DitherArea } from "../charts/Dither";
import { InlineChange } from "../charts/Inline";
import { periodTick, periodTitle } from "../charts/ticks";
import { WeekBars } from "../charts/WeekBars";
import { useAi } from "../lib/ai";
import { addDays, daysBetween, todayIn } from "../lib/dates";
import { fmtAgo, fmtCompact, fmtDayShort, fmtHours, fmtHoursValue, fmtInt, fmtPct, fmtTime, hoursParts, WEEKDAYS_SHORT } from "../lib/format";
import { momentText } from "../lib/insights";
import { leadInEnd } from "../lib/leadIn";
import { periodFor, useRange, type Range } from "../lib/range";
import { fillPeriods } from "../lib/series";
import { useDesktop } from "../lib/useMedia";
import { AppLink } from "../ui/AppLink";
import { Artwork, type ArtKind } from "../ui/Artwork";
import { buttonClass } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { CaretRightIcon, WaveformIcon } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { Page, PageHeader, SIDE_COLUMNS, Section, dimWhile } from "../ui/Page";
import { RangePicker, useRangeLabel } from "../ui/RangePicker";
import { ArtistRow, Row, RowList, RowSkeleton, TrackRow } from "../ui/Rows";
import { ChartSkeleton, Skeleton } from "../ui/Skeleton";
import { StatStrip, type StatItem } from "../ui/Stat";
import { StartSessionButton } from "../ui/StartSessionButton";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { KINDS, PlaylistShelf, PlaylistShelfSkeleton } from "./playlists/shared";

const weekdayShort = (day: string) => WEEKDAYS_SHORT[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]!;
const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** The week's best artist or song: art, what it is, the name, its hours. The lead of This week. */
function BestTile({ to, label, name, detail, art }: { to: string; label: string; name: string; detail: string; art: { src: string | null; kind: ArtKind } }) {
  return (
    <AppLink to={to} className="-m-2 flex min-w-0 items-center gap-3 rounded-lg p-2 transition-colors duration-150 hover:bg-fill">
      <Artwork src={art.src} kind={art.kind} box={64} className="phone:size-14" />
      <span className="flex min-w-0 flex-col">
        <span className="text-caption text-secondary">{label}</span>
        <span className="line-clamp-2 font-medium text-primary [overflow-wrap:anywhere]">{name}</span>
        <span className="truncate text-caption text-secondary tabular">{detail}</span>
      </span>
    </AppLink>
  );
}

function WeekBest({ week }: { week: WeekSoFar }) {
  const { topArtist: artist, topTrack: song } = week;
  if (!artist && !song) return null;
  return (
    <div className="grid gap-4 @min-[520px]/page:grid-cols-2">
      {artist && (
        <BestTile
          to={artistPath(artist.artist)}
          label="Artist of the week"
          name={artist.artist}
          detail={`${fmtHours(artist.hours)} · ${plural(artist.listens, "listen", "listens")}`}
          art={{ src: artist.imageUrl, kind: "artist" }}
        />
      )}
      {song && (
        <BestTile
          to={songPath(song.songKey)}
          label="Song of the week"
          name={song.name}
          detail={`${song.artist} · ${plural(song.listens, "listen", "listens")}`}
          art={{ src: song.albumArtUrl, kind: "song" }}
        />
      )}
    </div>
  );
}

/** The hours so far, the change against the usual by now, and how much of the week was repeats. */
function WeekFigure({ week }: { week: WeekSoFar }) {
  const { usual, repeats } = week;
  const parts = hoursParts(week.hours);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex items-baseline gap-1.5">
          <span className="font-display text-figure text-primary tabular">{parts.value}</span>
          <span className="text-secondary">{parts.unit}</span>
        </span>
        {usual && usual.hours > 0 ? (
          <span className="flex items-baseline gap-2 text-secondary">
            {week.hours > 0 && <InlineChange now={week.hours} before={usual.hours} />}
            <span>{week.hours > 0 ? `against a usual ${fmtHours(usual.hours)} by now` : `Nothing yet. By now you usually have ${fmtHours(usual.hours)}`}</span>
          </span>
        ) : (
          <span className="text-secondary">{week.hours > 0 ? plural(week.plays, "play", "plays") : "Nothing played yet"}</span>
        )}
      </p>
      {repeats.share !== null && repeats.listens > 0 && <p className="text-secondary tabular">Repeats {fmtPct(repeats.share)} of listens</p>}
    </div>
  );
}

function Days({ week }: { week: WeekSoFar }) {
  const desktop = useDesktop();
  const days = week.days.map((d) => ({ ...d, label: weekdayShort(d.day), today: d.day === week.today }));
  return (
    <div className="flex flex-col gap-2">
      <WeekBars days={days} format={fmtHours} height={desktop ? 112 : 88} />
      {week.usual && (
        <p className="flex items-center gap-2 text-caption text-secondary">
          <span aria-hidden className="h-0.5 w-3 rounded-full bg-primary" />
          Usual for the day
        </p>
      )}
    </div>
  );
}

const MOMENT_PATH: Record<Moment["target"], string> = { records: "/patterns/records", discovery: "/patterns/discovery" };

/** Up to three facts of the week, each opening the Patterns tab that holds it. Nothing while loading or after a failed load. */
function Moments() {
  const items = useMoments().data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <ul aria-label="This week's moments" className="flex flex-col gap-1 md:flex-row md:flex-wrap md:gap-x-6">
      {items.map((m) => (
        <li key={m.kind} className="min-w-0">
          <AppLink to={MOMENT_PATH[m.target]} className="-mx-1 flex min-h-11 items-center gap-1 rounded-sm px-1 text-primary text-pretty hover:underline md:min-h-0">
            {momentText(m)}
            <Icon icon={CaretRightIcon} size="sm" className="shrink-0 text-tertiary" />
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

/** When a play ended, short enough for a row's figure: the time today, the weekday this week, else the date. */
function playedWhen(ts: string, day: string, today: string, timezone: string): string {
  if (day === today) return fmtTime(ts, timezone);
  return daysBetween(day, today) <= 7 ? weekdayShort(day) : fmtDayShort(day);
}

/** The newest plays, the song playing now first. */
function RecentlyPlayed() {
  const desktop = useDesktop();
  const timezone = useTimezone();
  const today = todayIn(timezone);
  const limit = desktop ? 6 : 3;
  const q = useRecentPlays(limit);
  const now = usePlayerNow().data;
  const playing = now?.playing && now.track ? now.track : null;
  const items = (q.data?.items ?? []).filter((p) => p.uri && p.name).slice(0, playing ? limit - 1 : limit);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-(--control-h-sm) items-center justify-between gap-4">
        <h3 className="font-medium text-primary">Recently played</h3>
        <AppLink to="/plays" className={buttonClass({ variant: "ghost", size: "sm", className: "-mr-2.5" })}>
          Show all
        </AppLink>
      </div>
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={limit} />
      ) : items.length === 0 && !playing ? (
        <p className="text-secondary">Nothing played yet.</p>
      ) : (
        <RowList label="Recently played">
          {playing && (
            <Row
              title={playing.name}
              subtitle={playing.artist}
              art={{ src: playing.albumArtUrl, kind: "song" }}
              value={<span className="text-accent-text">Now</span>}
              song={{ uri: playing.uri, name: playing.name, artist: playing.artist }}
            />
          )}
          {items.map((p) => (
            <Row
              key={p.id}
              to={p.songKey ? songPath(p.songKey) : undefined}
              title={p.name!}
              subtitle={p.artist ?? undefined}
              art={{ src: p.albumArtUrl, kind: "song" }}
              value={playedWhen(p.ts, p.day, today, timezone)}
              song={{ uri: p.uri!, name: p.name!, songKey: p.songKey, artist: p.artist }}
            />
          ))}
        </RowList>
      )}
    </div>
  );
}

/** How much the owner listened this week against their usual: it leads Home because it changes every day. */
function ThisWeek() {
  const q = useWeek();
  const week = q.data;
  return (
    <Section title="This week" description={week ? `${weekdayShort(week.from)} ${fmtDayShort(week.from)} – ${weekdayShort(week.to)} ${fmtDayShort(week.to)}` : undefined}>
      <div className={SIDE_COLUMNS}>
        <div className="flex min-w-0 flex-col gap-6">
          {q.isError ? (
            <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
          ) : !week ? (
            <div aria-busy className="flex flex-col gap-6">
              <div className="grid gap-4 @min-[520px]/page:grid-cols-2">
                {[0, 1].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="size-16 rounded-md phone:size-14" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  </div>
                ))}
              </div>
              <Skeleton className="h-8 w-64" />
              <ChartSkeleton className="h-[120px] md:h-[150px]" />
            </div>
          ) : (
            <>
              <WeekBest week={week} />
              <WeekFigure week={week} />
              <Days week={week} />
            </>
          )}
          <Moments />
        </div>
        <RecentlyPlayed />
      </div>
    </Section>
  );
}

/** Songs played far more in the last two weeks than usual. Absent when there are none. */
function OnRepeat() {
  const desktop = useDesktop();
  const q = useOnRepeat(desktop ? 5 : 3);
  if (q.data?.items.length === 0) return null;
  const max = Math.max(...(q.data?.items.map((s) => s.listens) ?? [1]), 1);
  return (
    <Section title="On repeat" description="Listens in the last two weeks" actions={q.data && <StartSessionButton uris={q.data.items.map((s) => s.uri)} className="phone:hidden" />}>
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={3} />
      ) : (
        <RowList label="On repeat">
          {q.data.items.map((s) => (
            <TrackRow key={s.songKey} song={s} value={fmtInt(s.listens)} share={s.listens / max} />
          ))}
        </RowList>
      )}
    </Section>
  );
}

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
    { id: "hours", label: "Hours", value: fmtHoursValue(o.hours), delta: change(o.hours, before?.hours), compare: before ? `from ${fmtHoursValue(before.hours)}` : undefined },
    { id: "plays", label: "Plays", value: fmtCompact(o.plays), delta: change(o.plays, before?.plays), compare: before ? `from ${fmtCompact(before.plays)}` : undefined },
    { id: "listens", label: "Listens", value: fmtCompact(o.listens), delta: change(o.listens, before?.listens), compare: before ? `from ${fmtCompact(before.listens)}` : undefined },
  ];
}

function RangeChart({ metric, range, firstDay }: { metric: Metric; range: Range; firstDay: string | null }) {
  const today = todayIn(useTimezone());
  const desktop = useDesktop();
  const q = useTimeSeries(range, periodFor(range, firstDay, today));
  if (q.isError) return <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} title="Could not load the chart" />;
  if (!q.data) return <ChartSkeleton className="h-[96px] md:h-[120px]" />;
  const period = q.data.period;
  const unit = period === "day" ? "per day" : period === "week" ? "per week" : "per month";
  const points = fillPeriods(q.data.points, period, range, today, (p) => ({ period: p, hours: 0, plays: 0, listens: 0 }));
  const start = period === "month" ? leadInEnd(points.map((p) => p.hours)) : 0;
  const rows = points.slice(start).map((p) => ({
    period: p.period,
    title: periodTitle(p.period, period),
    value: p[metric],
  }));
  return (
    <div className={`flex flex-col gap-1 ${dimWhile(q.isPlaceholderData)}`}>
      <DitherArea
        label={`${METRIC_LABEL[metric]} ${unit}`}
        rows={rows}
        xKey="period"
        tipLabel="title"
        valueKey="value"
        valueLabel={METRIC_LABEL[metric]}
        xFormat={(p) => periodTick(p, period)}
        format={metric === "hours" ? fmtHours : fmtInt}
        table={{ format: metric === "hours" ? fmtHoursValue : fmtInt }}
        height={desktop ? 120 : 96}
        dataButton={false}
      />
      {start > 0 && <p className="text-caption text-secondary">From {periodTitle(rows[0]!.period, period)}</p>}
    </div>
  );
}

/** The range's totals against the range before (when there is one), driving the chart of the range. */
function RangeFigures({ range, overview, firstDay }: { range: Range; overview: UseQueryResult<OverviewData>; firstDay: string | null }) {
  const prev = previousRange(range);
  const before = useOverview(prev ?? range);
  const [metric, setMetric] = useState<Metric>("hours");
  if (overview.isError) return <ErrorState size="inline" error={overview.error} onRetry={() => overview.refetch()} />;
  if (!overview.data)
    return (
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
    );
  const compare = prev && before.data && !before.isPlaceholderData ? before.data : undefined;
  return (
    <div className={dimWhile(overview.isPlaceholderData)}>
      <StatStrip items={figures(overview.data, compare)} value={metric} onChange={setMetric} label="Listening figures">
        <RangeChart metric={metric} range={range} firstDay={firstDay} />
      </StatStrip>
    </div>
  );
}

function Column({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="flex items-baseline gap-2 font-medium text-primary">
        {title}
        {count ? <span className="font-normal text-tertiary tabular">{fmtCompact(count)}</span> : null}
      </h3>
      {children}
    </div>
  );
}

function TopArtists({ range, count }: { range: Range; count?: number }) {
  const desktop = useDesktop();
  const q = useTopArtists(range, 5);
  const items = q.data?.items ?? [];
  const max = items[0]?.hours || 1;
  return (
    <Column title="Artists" count={count}>
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={5} rank />
      ) : (
        <RowList label="Top artists" className={dimWhile(q.isPlaceholderData)}>
          {items.map((a, i) => (
            <ArtistRow key={a.artist} artist={a} rank={i + 1} value={fmtHours(a.hours)} share={desktop ? a.hours / max : undefined} narrowMeter />
          ))}
        </RowList>
      )}
    </Column>
  );
}

function TopSongs({ range, count }: { range: Range; count?: number }) {
  const desktop = useDesktop();
  const q = useTopTracks(range, 5);
  const items = q.data?.items ?? [];
  const max = items[0]?.hours || 1;
  return (
    <Column title="Songs" count={count}>
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={5} rank />
      ) : (
        <RowList label="Top songs" className={dimWhile(q.isPlaceholderData)}>
          {items.map((s, i) => (
            <TrackRow key={s.songKey} song={s} rank={i + 1} value={fmtHours(s.hours)} share={desktop ? s.hours / max : undefined} narrowMeter />
          ))}
        </RowList>
      )}
    </Column>
  );
}

/** The best song of this day in each earlier year, up to three. Absent when there is no earlier year. */
function OnThisDay() {
  const q = useOnThisDay();
  if (q.data?.years.length === 0) return null;
  return (
    <Column title="On this day">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={3} />
      ) : (
        <ol className="flex flex-col">
          {q.data.years.slice(0, 3).map((y) => {
            const top = y.topTracks[0];
            return (
              <li key={y.year}>
                <AppLink
                  to={top ? songPath(top.songKey) : "/plays"}
                  className="-mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 transition-colors duration-150 hover:bg-fill"
                >
                  <span className="w-10 shrink-0 text-secondary tabular">{y.year}</span>
                  {top && <Artwork src={top.albumArtUrl} kind="song" box={32} className="phone:size-10" />}
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
    </Column>
  );
}

/**
 * The long view, for any range (All time first): the totals drive the chart of the range, then the top artists and
 * songs beside this day in earlier years. One range picker scopes the whole group.
 */
function Listening({ range, overview, firstDay }: { range: Range; overview: UseQueryResult<OverviewData>; firstDay: string | null }) {
  const title = useRangeLabel();
  const empty = overview.data?.plays === 0;
  return (
    <Section title={title} actions={<RangePicker />}>
      {empty ? (
        <EmptyState size="section" title="No plays in this range" description="Choose a wider range to see your listening." />
      ) : (
        <div className="flex flex-col gap-10">
          <RangeFigures range={range} overview={overview} firstDay={firstDay} />
          <div className="flex flex-col gap-3">
            <div className="grid gap-10 @min-[600px]/page:grid-cols-2 @min-[780px]/page:grid-cols-3 @min-[600px]/page:gap-8">
              <TopArtists range={range} count={overview.data?.uniqueArtists} />
              <TopSongs range={range} count={overview.data?.uniqueTracks} />
              <OnThisDay />
            </div>
            <AppLink to="/music" className={buttonClass({ variant: "ghost", size: "sm", className: "-ml-2.5 self-start" })}>
              Show all in Music
            </AppLink>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Right now first: it changes most often. Then the other built-ins in their usual order. */
const SHELF_ORDER: LivingKind[] = ["right-now", ...KINDS.filter((k) => k !== "right-now")];

function MadeForYou() {
  const q = useLiving();
  const ai = useAi();
  const items = (q.data?.items ?? [])
    .filter((p) => p.builtin && (ai.configured || p.kind !== "picks"))
    .sort((a, b) => SHELF_ORDER.indexOf(a.kind as LivingKind) - SHELF_ORDER.indexOf(b.kind as LivingKind));
  return (
    <Section
      title="Made for you"
      actions={
        <AppLink to="/playlists" className={buttonClass({ variant: "ghost", size: "sm", className: "-mr-2.5" })}>
          Open Playlists
        </AppLink>
      }
    >
      {q.isError ? <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <PlaylistShelfSkeleton /> : <PlaylistShelf items={items} />}
    </Section>
  );
}

/** One line on the week so far that opens its recap period, read live from the week's figures. */
function WeekRecapLink() {
  const week = useWeek().data;
  if (!week) return null;
  const text = week.hours > 0 ? `This week so far: ${fmtHours(week.hours)}${week.topArtist ? `, mostly ${week.topArtist.artist}` : ""}` : "This week so far: nothing played yet";
  return (
    <AppLink to={recapPath("weekly", week.to)} className="-mx-2 flex min-h-11 items-center gap-2 self-start max-w-[calc(100%+1rem)] rounded-md px-2 text-secondary transition-colors duration-150 hover:bg-fill hover:text-primary">
      <span className="min-w-0 truncate">{text}</span>
      <Icon icon={CaretRightIcon} size="sm" className="shrink-0 text-tertiary" />
    </AppLink>
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
 * Home: stats first. This week leads (the week's best, the hours against the usual, a column per day with the usual
 * tick, its moments, what played last), then what is on repeat, then the long view for any range, then the playlists.
 * A phone puts the playlists before the long view: it is picked up to glance and play. Each block loads on its own.
 */
export function Home() {
  const { range } = useRange();
  const lifetime = useLifetime();
  const overview = useOverview(range);
  const desktop = useDesktop();
  const firstUse = lifetime.data?.plays === 0;
  const listening = <Listening key="listening" range={range} overview={overview} firstDay={lifetime.data?.firstPlayed?.slice(0, 10) ?? null} />;
  const playlists = <MadeForYou key="playlists" />;
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
          <OnRepeat />
          {desktop ? [listening, playlists] : [playlists, listening]}
          <WeekRecapLink />
        </>
      )}
    </Page>
  );
}
