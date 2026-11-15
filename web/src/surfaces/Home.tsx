import { useState } from "react";
import { useLocation } from "wouter";
import { useDigests, useLifetime, useLiving, useOnThisDay, useOverview, usePicks, useRadar, useStatus, useTopAlbums, useTopArtists, useTopTracks, useWeek } from "../api/queries";
import type { Overview as OverviewData, Status, WeekSoFar } from "../api/types";
import { artistPath, recapPath, songPath } from "../app/paths";
import { DitherBars } from "../charts/Dither";
import { InlineChange, InlinePair } from "../charts/Inline";
import { fmtAgo, fmtCompact, fmtDay, fmtDayShort, fmtHour, fmtHours, fmtHoursValue, fmtInt, hoursParts, WEEKDAYS, WEEKDAYS_SHORT } from "../lib/format";
import { useRange, type Range } from "../lib/range";
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
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { StartSessionButton } from "../ui/StartSessionButton";
import { PickPreviews } from "./Picks";
import { CoversSkeleton, PlaylistCovers } from "./Playlists";

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
        <PickPreviews picks={picks.slice(0, 3)} />
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

/** New releases not yet seen and the latest recap by its headline: each only when there is one. */
function WhatsNew() {
  const radar = useRadar("new");
  const digests = useDigests();
  const releases = (radar.data?.items ?? []).filter((r) => !r.seen).slice(0, 3);
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
      {recap && (
        <Section title="Latest recap">
          <AppLink to={recapPath(recap.kind, recap.periodKey)} className="-mx-2 flex flex-col rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-fill">
            <span className="truncate text-primary">{recap.headline}</span>
            <span className="truncate text-caption text-secondary">{`${recap.title} · ${fmtAgo(recap.createdAt)}`}</span>
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
      {q.isError ? <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <CoversSkeleton compact /> : <PlaylistCovers list={q.data} compact />}
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
 * Home: this week against the usual first, since it changes every day; then the playlists encore keeps, one composer for
 * Ask or Sets beside what is new (this week's picks, new releases, the latest recap); then the top lists for any range
 * beside On this day. Music and Patterns hold the full answers.
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
          description="Import your Spotify history or connect Spotify. Then Home shows how much you listen each week, playlists made from your listening and Claude’s picks."
        />
      ) : (
        <>
          <StatusNotice />
          <ThisWeek />
          <MadeForYou />
          <div className={SIDE_COLUMNS}>
            <div className="flex min-w-0 flex-col gap-10">
              <AskOrSet />
              <WeekPicks />
            </div>
            <div className="flex min-w-0 flex-col gap-10">
              <WhatsNew />
            </div>
          </div>
          <div className={SIDE_COLUMNS}>
            <Section title="Most played" description={overview.data && overview.data.plays > 0 ? `${hoursText(overview.data.hours)}, ${plural(overview.data.listens, "play", "plays")}` : undefined} actions={<RangePicker />}>
              <Top range={range} overview={overview.data} />
            </Section>
            <OnThisDay />
          </div>
        </>
      )}
    </Page>
  );
}
