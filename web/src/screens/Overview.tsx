import { useState } from "react";
import { useLifetime, useOnThisDay, useOverview, useStatus, useTimeSeries, useTimezone, useTopArtists, useTopTracks } from "../api/queries";
import type { Status } from "../api/types";
import { DitherBars } from "../charts/Dither";
import { periodTick, periodTitle } from "../charts/ticks";
import { TagTrends } from "../charts/TagTrends";
import { todayIn } from "../lib/dates";
import { fmtAgo, fmtDayShort, fmtHours, fmtInt, hoursParts, fmtPct } from "../lib/format";
import { periodFor, useRange } from "../lib/range";
import { fillPeriods } from "../lib/series";
import { AppLink, artistPath, songPath } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Page, Section } from "../ui/Page";
import { StartSessionButton } from "../ui/SongMenu";
import { MoreButton, Row, RowList } from "../ui/rows";
import { Shelf, ShelfSkeleton, ShowAll, Tile } from "../ui/Shelf";
import { Empty, ErrorState, Skeleton, SkeletonRows } from "../ui/states";

function Headline() {
  const { range } = useRange();
  const q = useOverview(range);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-48 md:h-14" />
        <Skeleton className="h-5 w-full max-w-lg" />
      </div>
    );
  const o = q.data;
  if (o.plays === 0) return <Empty title="No plays in this range">Pick a wider range to see your listening.</Empty>;
  return (
    <div className={`grid items-end gap-6 transition-opacity lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] ${q.isPlaceholderData ? "opacity-60" : ""}`}>
      <div className="flex flex-col gap-3">
        <p className="flex items-baseline gap-2">
          <span className="text-heading-2 font-semibold md:text-heading-1">{hoursParts(o.hours).value}</span>
          <span className="text-heading-6 font-medium text-secondary">{hoursParts(o.hours).unit}</span>
        </p>
        <p className="max-w-2xl text-body-lg text-secondary text-pretty">
          <strong className="font-semibold text-primary tabular">{fmtInt(o.plays)}</strong> plays of{" "}
          <strong className="font-semibold text-primary tabular">{fmtInt(o.uniqueTracks)}</strong> songs by{" "}
          <strong className="font-semibold text-primary tabular">{fmtInt(o.uniqueArtists)}</strong> artists.{" "}
          <strong className="font-semibold text-primary tabular">{fmtPct(o.skipRate)}</strong> skipped,{" "}
          <strong className="font-semibold text-primary tabular">{fmtPct(o.shuffleRate)}</strong> on shuffle.
        </p>
      </div>
      {o.topArtist && (
        <AppLink
          to={artistPath(o.topArtist.artist)}
          className="press flex items-center gap-4 rounded-2xl bg-raised p-3 transition-colors duration-150 hover-fine:bg-raised-hover"
        >
          <Artwork src={o.topArtist.imageUrl} name={o.topArtist.artist} size="md" className="w-24 rounded-xl md:w-28" />
          <span className="flex min-w-0 flex-col">
            <span className="text-body-sm text-secondary">Most played artist</span>
            <span className="truncate text-heading-6 font-semibold">{o.topArtist.artist}</span>
            <span className="text-body-sm text-secondary tabular">
              {fmtHours(o.topArtist.hours)}, {fmtInt(o.topArtist.listens)} listens
            </span>
          </span>
        </AppLink>
      )}
    </div>
  );
}

function OverTime() {
  const { range } = useRange();
  const timezone = useTimezone();
  const today = todayIn(timezone);
  const lifetime = useLifetime();
  const firstDay = lifetime.data?.firstPlayed?.slice(0, 10) ?? null;
  const period = periodFor(range, firstDay, today);
  const q = useTimeSeries(range, period);
  const unit = period === "day" ? "per day" : period === "week" ? "per week" : "per month";
  return (
    <Section title="Listening over time" aside={<span className="text-body-sm text-secondary">Hours {unit}</span>}>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-50 w-full" />
      ) : q.data.points.length === 0 ? (
        <Empty title="Nothing played in this range" />
      ) : (
        <div className={q.isPlaceholderData ? "opacity-60" : ""}>
          <DitherBars
            label={`Hours listened ${unit}`}
            rows={fillPeriods(q.data.points, q.data.period, range, today, (p) => ({ period: p, hours: 0, plays: 0, listens: 0 })).map((p) => ({
              period: p.period,
              title: periodTitle(p.period, q.data.period),
              hours: p.hours,
            }))}
            xKey="period"
            tipLabel="title"
            valueKey="hours"
            valueLabel="Hours"
            xFormat={(p) => periodTick(p, q.data.period)}
            format={fmtHours}
          />
        </div>
      )}
    </Section>
  );
}

function TopArtists() {
  const { range } = useRange();
  const q = useTopArtists(range, 20);
  const [expanded, setExpanded] = useState(false);
  return (
    <Section title="Top artists" aside={q.data && q.data.items.length > 6 && <ShowAll expanded={expanded} onToggle={() => setExpanded((e) => !e)} />}>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <ShelfSkeleton round />
      ) : q.data.items.length === 0 ? (
        <Empty title="No artists in this range" />
      ) : (
        <Shelf label="Top artists" expanded={expanded} className={q.isPlaceholderData ? "opacity-60" : ""}>
          {q.data.items.map((a, i) => (
            <Tile key={a.artist} to={artistPath(a.artist)} src={a.imageUrl} round rank={i + 1} title={a.artist} subtitle={fmtHours(a.hours)} />
          ))}
        </Shelf>
      )}
    </Section>
  );
}

function TopSongs() {
  const { range } = useRange();
  const [expanded, setExpanded] = useState(false);
  const q = useTopTracks(range, expanded ? 50 : 10);
  return (
    <Section title="Top songs" aside={q.data && <StartSessionButton uris={q.data.items.map((s) => s.uri)} />}>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <SkeletonRows rows={10} />
      ) : q.data.items.length === 0 ? (
        <Empty title="No songs in this range" />
      ) : (
        <>
          <div className={`grid gap-x-8 md:grid-cols-2 ${q.isPlaceholderData && !expanded ? "opacity-60" : ""}`}>
            {[0, 1].map((half) => {
              const size = Math.ceil(q.data.items.length / 2);
              return (
                <RowList key={half} className={half === 1 ? "border-t-[0.5px] border-border-default md:border-t-0" : ""}>
                  {q.data.items.slice(half * size, (half + 1) * size).map((s, i) => (
                    <Row
                      key={s.songKey}
                      to={songPath(s.songKey)}
                      rank={half * size + i + 1}
                      art={{ src: s.albumArtUrl }}
                      song={{ uri: s.uri, name: s.name }}
                      title={s.name}
                      subtitle={s.artist}
                      value={fmtHours(s.hours)}
                    />
                  ))}
                </RowList>
              );
            })}
          </div>
          {q.data.items.length >= 10 && <MoreButton expanded={expanded} onClick={() => setExpanded((e) => !e)} more="Show top 50" />}
        </>
      )}
    </Section>
  );
}

function OnThisDay() {
  const q = useOnThisDay();
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load on this day" />;
  if (!q.data) return <SkeletonRows rows={3} />;
  if (q.data.years.length === 0) return null;
  return (
    <Section title="On this day" aside={<span className="text-body-sm text-secondary">{fmtDayShort(q.data.date)} in earlier years</span>}>
      <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
        {q.data.years.map((y) => (
          <div key={y.year} className="flex flex-col gap-1">
            <p className="flex items-baseline justify-between gap-3">
              <span className="font-semibold tabular">{y.year}</span>
              <span className="text-body-sm text-secondary tabular">
                {fmtHours(y.hours)}, {fmtInt(y.plays)} plays
              </span>
            </p>
            <RowList>
              {y.topTracks.map((s) => (
                <Row
                  key={s.songKey}
                  to={songPath(s.songKey)}
                  art={{ src: s.albumArtUrl }}
                  song={{ uri: s.uri, name: s.name }}
                  title={s.name}
                  subtitle={s.artist}
                  value={`${s.listens} ${s.listens === 1 ? "listen" : "listens"}`}
                />
              ))}
            </RowList>
          </div>
        ))}
      </div>
    </Section>
  );
}

function statusLine(s: Status): { text: string; problem: boolean } {
  if (!s.spotify.connected) return { text: "Spotify is not connected, so new plays are not being logged.", problem: true };
  if (s.spotify.paused?.reason === "quota_exceeded")
    return { text: `Spotify quota reached. Logging resumes ${s.spotify.paused.until ? fmtAgo(s.spotify.paused.until) : "later"}.`, problem: true };
  if (s.poll.lastError) return { text: `Last sync failed: ${s.poll.lastError}`, problem: true };
  const synced = s.poll.lastSuccessAt ? `synced ${fmtAgo(s.poll.lastSuccessAt)}` : "not synced yet";
  return { text: `Spotify connected, ${synced}.`, problem: false };
}

function StatusLine({ placement }: { placement: "top" | "bottom" }) {
  const q = useStatus();
  if (!q.data) return null;
  const { text, problem } = statusLine(q.data);
  if ((placement === "top") !== problem) return null;
  return (
    <p className={problem ? "text-warning" : "text-body-sm text-secondary"}>
      {text}{" "}
      {problem && (
        <AppLink to="/settings" className="font-medium text-primary underline underline-offset-2">
          Open settings
        </AppLink>
      )}
    </p>
  );
}

export default function Overview() {
  const { range } = useRange();
  return (
    <Page title="Overview" ranged>
      <StatusLine placement="top" />
      <Headline />
      <OverTime />
      <TopArtists />
      <TopSongs />
      <OnThisDay />
      <TagTrends range={range} />
      <StatusLine placement="bottom" />
    </Page>
  );
}
