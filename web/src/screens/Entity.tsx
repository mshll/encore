import { useState } from "react";
import { useAlbumPage, useArtistPage, useLifetime, useTimezone, useTrackPage } from "../api/queries";
import { ApiError } from "../api/client";
import type { ContextDimension, MomentClass, SkipProfile, Song, Stats, TimePoint } from "../api/types";
import { SkipProfileChart } from "../charts/SkipProfileChart";
import { DitherBars } from "../charts/Dither";
import { periodTick, periodTitle } from "../charts/ticks";
import { todayIn } from "../lib/dates";
import { CLASS_LABELS, contextPhrase, fmtDate, fmtHours, fmtInt, fmtPct, hoursParts } from "../lib/format";
import { periodFor, useRange, type Range } from "../lib/range";
import { fillPeriods } from "../lib/series";
import { AppLink, albumPath, artistPath, songPath } from "../ui/AppLink";
import { PlayButtons } from "../ui/SongMenu";
import { EntityHero } from "../ui/Artwork";
import { Page, Section } from "../ui/Page";
import { MoreButton, Row, RowList } from "../ui/rows";
import { Empty, ErrorState, Skeleton, SkeletonRows } from "../ui/states";
import { CLASS_HINT, CLASS_STYLE } from "./Skips";

type Props = { kind: "artist" | "album" | "song"; artist?: string; album?: string; songKey?: string };

function usePeriod(range: Range) {
  const timezone = useTimezone();
  const lifetime = useLifetime();
  const today = todayIn(timezone);
  return { period: periodFor(range, lifetime.data?.firstPlayed?.slice(0, 10) ?? null, today), today };
}

function Totals({ totals }: { totals: Stats }) {
  const timezone = useTimezone();
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-baseline gap-2">
        <span className="text-heading-3 font-semibold md:text-heading-2">{hoursParts(totals.hours).value}</span>
        <span className="text-heading-6 font-medium text-secondary">{hoursParts(totals.hours).unit}</span>
      </p>
      <p className="max-w-3xl text-body-lg text-secondary text-pretty">
        <strong className="font-semibold text-primary tabular">{fmtInt(totals.plays)}</strong> plays,{" "}
        <strong className="font-semibold text-primary tabular">{fmtInt(totals.listens)}</strong> past 30 seconds.{" "}
        {totals.skipRate !== null && (
          <>
            <strong className="font-semibold text-primary tabular">{fmtPct(totals.skipRate)}</strong> skipped, {fmtInt(totals.quickSkips)} within 5
            seconds.{" "}
          </>
        )}
        {totals.firstPlayed && totals.lastPlayed && (
          <>
            First played {fmtDate(totals.firstPlayed, timezone)}, last played {fmtDate(totals.lastPlayed, timezone)}.
          </>
        )}
      </p>
    </div>
  );
}

function Timeline({ timeline, range }: { timeline: TimePoint[]; range: Range }) {
  const { period, today } = usePeriod(range);
  if (timeline.length === 0) return null;
  const unit = period === "day" ? "per day" : period === "week" ? "per week" : "per month";
  return (
    <Section title="Over time" aside={<span className="text-body-sm text-secondary">Hours {unit}</span>}>
      <DitherBars
        label={`Hours ${unit}`}
        height={180}
        rows={fillPeriods(timeline, period, range, today, (p) => ({ period: p, hours: 0, plays: 0, listens: 0 })).map((p) => ({
          period: p.period,
          title: periodTitle(p.period, period),
          hours: p.hours,
        }))}
        xKey="period"
        tipLabel="title"
        valueKey="hours"
        valueLabel="Hours"
        xFormat={(p) => periodTick(p, period)}
        format={fmtHours}
      />
    </Section>
  );
}

function bestWorst(profile: SkipProfile) {
  const all = (Object.keys(profile) as ContextDimension[]).flatMap((d) =>
    profile[d].filter((v) => v.plays >= 3 && v.skipRate !== null).map((v) => ({ d, ...v, rate: v.skipRate! })),
  );
  if (all.length === 0) return null;
  const sorted = [...all].sort((a, b) => a.rate - b.rate || b.plays - a.plays);
  return { best: sorted[0]!, worst: sorted[sorted.length - 1]! };
}

function Verdict({ cls, profile }: { cls: MomentClass; profile: SkipProfile }) {
  const bw = bestWorst(profile);
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className="mt-1.5 size-3 shrink-0 rounded-[3px]" style={{ background: CLASS_STYLE[cls].color }} />
      <div className="flex flex-col gap-0.5">
        <p className="font-semibold">{CLASS_LABELS[cls]}</p>
        <p className="text-secondary text-pretty">
          {cls === "wrong_moment" && bw
            ? `Plays through ${contextPhrase(bw.best.d, bw.best.value)} (${fmtPct(bw.best.rate)} skipped), skipped ${contextPhrase(bw.worst.d, bw.worst.value)} (${fmtPct(bw.worst.rate)}).`
            : CLASS_HINT[cls]}
        </p>
      </div>
    </div>
  );
}

function SongList({ title, songs, showAlbum }: { title: string; songs: Song[]; showAlbum?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (songs.length === 0) return null;
  return (
    <Section title={title}>
      <RowList>
        {songs.slice(0, expanded ? 50 : 10).map((s, i) => (
          <Row
            key={s.songKey}
            to={songPath(s.songKey)}
            rank={i + 1}
            art={{ src: s.albumArtUrl }}
            song={{ uri: s.uri, name: s.name }}
            title={s.name}
            subtitle={showAlbum ? (s.album ?? undefined) : s.artist}
            value={fmtHours(s.hours)}
            detail={`${fmtPct(s.skipRate)} skipped`}
          />
        ))}
      </RowList>
      {songs.length > 10 && <MoreButton expanded={expanded} onClick={() => setExpanded((e) => !e)} />}
    </Section>
  );
}

function Missing({ error, retry, what }: { error: unknown; retry: () => void; what: string }) {
  if (error instanceof ApiError && error.status === 404)
    return <Empty title={`No plays of this ${what} in this range`}>Pick a wider range, or All time.</Empty>;
  return <ErrorState error={error} onRetry={retry} />;
}

function Loading() {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12 w-40" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <Skeleton className="h-44 w-full" />
      <SkeletonRows rows={6} />
    </div>
  );
}

function SeeHistory({ query }: { query: string }) {
  return (
    <AppLink to={`/history?${query}`} className="btn btn-secondary">
      See every play
    </AppLink>
  );
}

function ArtistView({ name }: { name: string }) {
  const { range } = useRange();
  const { period } = usePeriod(range);
  const q = useArtistPage(name, range, period);
  return (
    <Page
      title={name}
      docTitle={name}
      hero={(controls) => <EntityHero art={q.data?.imageUrl} round name={name} controls={controls} />}
      ranged
      actions={
        <>
          <PlayButtons uris={q.data?.tracks.map((t) => t.uri) ?? []} />
          <SeeHistory query={`artist=${encodeURIComponent(name)}`} />
        </>
      }
    >
      {q.isError ? (
        <Missing error={q.error} retry={() => q.refetch()} what="artist" />
      ) : !q.data ? (
        <Loading />
      ) : (
        <div className={`flex flex-col gap-10 md:gap-14 ${q.isPlaceholderData ? "opacity-60" : ""}`}>
          <Totals totals={q.data.totals} />
          <Timeline timeline={q.data.timeline} range={range} />
          <div className="grid gap-10 md:gap-14 lg:grid-cols-2">
            <SongList title="Top songs" songs={q.data.tracks} showAlbum />
            {q.data.albums.length > 0 && (
              <Section title="Albums">
                <RowList>
                  {q.data.albums.slice(0, 10).map((a) => (
                    <Row
                      key={a.album}
                      to={albumPath(name, a.album)}
                      art={{ src: a.albumArtUrl }}
                      title={a.album}
                      subtitle={`${fmtInt(a.plays)} plays`}
                      value={fmtHours(a.hours)}
                    />
                  ))}
                </RowList>
              </Section>
            )}
          </div>
          <Section title="When it gets skipped">
            <SkipProfileChart profile={q.data.skipProfile} overall={q.data.totals.skipRate} minPlays={5} />
          </Section>
        </div>
      )}
    </Page>
  );
}

function AlbumView({ artist, album }: { artist: string; album: string }) {
  const { range } = useRange();
  const { period } = usePeriod(range);
  const q = useAlbumPage(artist, album, range, period);
  return (
    <Page
      title={album}
      hero={(controls) => (
        <EntityHero
          controls={controls}
          art={q.data?.albumArtUrl}
          name={album}
          meta={
            <AppLink to={artistPath(artist)} className="hover-fine:text-primary">
              {artist}
            </AppLink>
          }
        />
      )}
      docTitle={album}
      ranged
      actions={<PlayButtons uris={q.data?.tracks.map((t) => t.uri) ?? []} />}
    >
      {q.isError ? (
        <Missing error={q.error} retry={() => q.refetch()} what="album" />
      ) : !q.data ? (
        <Loading />
      ) : (
        <div className={`flex flex-col gap-10 md:gap-14 ${q.isPlaceholderData ? "opacity-60" : ""}`}>
          <Totals totals={q.data.totals} />
          <Timeline timeline={q.data.timeline} range={range} />
          <SongList title="Songs" songs={q.data.tracks} />
          <Section title="When it gets skipped">
            <SkipProfileChart profile={q.data.skipProfile} overall={q.data.totals.skipRate} minPlays={5} />
          </Section>
        </div>
      )}
    </Page>
  );
}

function SongView({ songKey }: { songKey: string }) {
  const { range } = useRange();
  const { period } = usePeriod(range);
  const q = useTrackPage(songKey, range, period);
  const d = q.data;
  return (
    <Page
      title={d?.name ?? ""}
      hero={(controls) =>
        d ? (
          <EntityHero
            controls={controls}
            art={d.albumArtUrl}
            name={d.name}
            meta={
              <>
                <AppLink to={artistPath(d.artist)} className="hover-fine:text-primary">
                  {d.artist}
                </AppLink>
                {d.album && (
                  <>
                    {", "}
                    <AppLink to={albumPath(d.artist, d.album)} className="hover-fine:text-primary">
                      {d.album}
                    </AppLink>
                  </>
                )}
              </>
            }
          />
        ) : (
          <div className="flex flex-col items-center gap-5 md:flex-row md:items-end md:gap-8">
            <Skeleton className="aspect-square w-full max-w-[360px] rounded-xl md:w-52" />
            <Skeleton className="h-12 w-64" />
          </div>
        )
      }
      docTitle={d?.name}
      ranged
      actions={
        <>
          {d && <PlayButtons uris={[d.uri]} queue={{ uri: d.uri, name: d.name }} />}
          <SeeHistory query={`songKey=${encodeURIComponent(songKey)}`} />
        </>
      }
    >
      {q.isError ? (
        <Missing error={q.error} retry={() => q.refetch()} what="song" />
      ) : !d ? (
        <Loading />
      ) : (
        <div className={`flex flex-col gap-10 md:gap-14 ${q.isPlaceholderData ? "opacity-60" : ""}`}>
          <Totals totals={d.totals} />
          <Timeline timeline={d.timeline} range={range} />
          <Section title="When it gets skipped">
            {d.class ? (
              <Verdict cls={d.class} profile={d.skipProfile} />
            ) : (
              <p className="text-secondary">Needs 8 plays with skip data before it can be classified.</p>
            )}
            <SkipProfileChart profile={d.skipProfile} overall={d.totals.skipRate} />
          </Section>
          {d.uris.length > 1 && (
            <Section title="Versions">
              <RowList>
                {d.uris.map((u) => (
                  <Row key={u.uri} title={u.name} subtitle={u.album ?? undefined} value={`${fmtInt(u.plays)} plays`} />
                ))}
              </RowList>
            </Section>
          )}
        </div>
      )}
    </Page>
  );
}

export default function Entity(props: Props) {
  if (props.kind === "artist") return <ArtistView key={props.artist} name={props.artist!} />;
  if (props.kind === "album") return <AlbumView key={`${props.artist}|${props.album}`} artist={props.artist!} album={props.album!} />;
  return <SongView key={props.songKey} songKey={props.songKey!} />;
}
