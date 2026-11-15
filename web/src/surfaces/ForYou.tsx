import type { ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLifetime, useLiving, usePicks, useRadar, useRecapPlaylists, useStatus } from "../api/queries";
import type { LivingKind, LivingList, LivingListItem, LivingPlaylist, PicksWeek, SavedRecapPlaylist } from "../api/types";
import { recapPath } from "../app/paths";
import { fmtDay, fmtHour, fmtInt, WEEKDAYS } from "../lib/format";
import { useRun } from "../lib/useRun";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button, buttonClass, iconButtonClass } from "../ui/Button";
import { useClaudeGate } from "../ui/ClaudeNotice";
import { cx } from "../ui/cx";
import { Icon } from "../ui/Icon";
import { ArrowUpRightIcon, PlayIcon, WaveformIcon } from "../ui/icons";
import { Page, PageHeader, Section, dimWhile } from "../ui/Page";
import { RowList, RowSkeleton } from "../ui/Rows";
import { Skeleton } from "../ui/Skeleton";
import { ErrorState, FirstUseState } from "../ui/States";
import { PickPreviews } from "./Picks";
import { freshLine, gateNotice, NOTHING_YET, playable, playlistPath, SongRow, useNews, usePlayPlaylist } from "./Playlists";
import { ReleaseRow } from "./Releases";

type Size = "lead" | "full" | "look";

const COVER: Record<Size, string> = { lead: "w-40 phone:w-16", full: "w-28 phone:w-16", look: "w-16" };

/** The line under a band's name: a problem first, then what is new or how fresh, and whether it is kept in Spotify. */
function bandLine(p: LivingPlaylist, news: string | null) {
  const line = freshLine(p, news);
  const kept = p.enabled && p.playlist !== null && !line.problem;
  return { ...line, text: kept ? `${line.text} · in your Spotify` : line.text };
}

/**
 * One playlist as a band: its cover and name (both open its page), what it is, how fresh it is, Play, and what it holds.
 * The size sets the cover: the lead band is largest, a look back smallest.
 */
function Band({ playlist, news, size, children }: { playlist: LivingPlaylist; news: string | null; size: Size; children: ReactNode }) {
  const play = usePlayPlaylist();
  const line = bandLine(playlist, news);
  const id = `band-${playlist.kind}`;
  return (
    <section aria-labelledby={id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-4 md:grid-rows-[auto_1fr] md:gap-x-8">
      <AppLink to={playlistPath(playlist.kind)} tabIndex={-1} aria-label={playlist.name} className={cx("shrink-0 self-start", COVER[size], size !== "look" && "md:row-span-2")}>
        <Artwork src={playlist.coverUrl} kind="playlist" box="fill" />
      </AppLink>
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="text-heading font-medium text-primary">
            <AppLink to={playlistPath(playlist.kind)} className="-my-1 inline-block py-1 hover:underline hover:underline-offset-2">
              {playlist.name}
            </AppLink>
          </h2>
          <p className="text-secondary text-pretty">{playlist.about}</p>
          <p className={cx("text-caption text-pretty", line.problem ? "text-danger" : news ? "text-primary" : "text-secondary")}>{line.text}</p>
        </div>
        {playable(playlist) && (
          <Button variant={size === "lead" ? "accent" : "secondary"} size="sm" icon={PlayIcon} onClick={() => void play(playlist)} className="shrink-0">
            Play
          </Button>
        )}
      </div>
      <div className={cx("min-w-0", size === "look" ? "col-span-2" : "max-md:col-span-2")}>{children}</div>
    </section>
  );
}

/** A playlist with nothing to put in it yet: one line that says so, or its problem. */
function EmptyBand({ playlist, news }: { playlist: LivingPlaylist; news: string | null }) {
  const fresh = freshLine(playlist, news);
  return (
    <AppLink to={playlistPath(playlist.kind)} className="-mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-fill">
      <Artwork src={playlist.coverUrl} kind="playlist" box={40} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-primary">{playlist.name}</span>
        <span className={cx("text-caption text-pretty", fresh.problem ? "text-danger" : "text-secondary")}>{fresh.problem ? fresh.text : NOTHING_YET[playlist.kind]}</span>
      </span>
    </AppLink>
  );
}

function MoreLink({ playlist, label }: { playlist: LivingPlaylist; label: string }) {
  return (
    <AppLink to={playlistPath(playlist.kind)} className={buttonClass({ variant: "ghost", size: "sm", className: "-ml-2.5 self-start" })}>
      {label}
    </AppLink>
  );
}

const songs = (n: number) => `${fmtInt(n)} ${n === 1 ? "song" : "songs"}`;
const total = (p: LivingPlaylist) => (p.enabled && p.playlist ? p.count : p.available);

/** The songs a playlist starts with, as rows with the song actions. `columns` lays a look back out across the band. */
function Songs({ playlist, rank, columns }: { playlist: LivingListItem; rank?: boolean; columns?: boolean }) {
  const shown = columns ? playlist.songs.slice(0, 3) : playlist.songs;
  const rest = total(playlist) - shown.length;
  return (
    <div className="flex flex-col gap-2">
      <RowList label={playlist.name} className={cx(columns && "md:grid md:grid-cols-3 md:gap-x-6")}>
        {shown.map((s, i) => (
          <SongRow key={s.uri} song={s} rank={rank ? i + 1 : undefined} kind={playlist.kind} />
        ))}
      </RowList>
      {rest > 0 && <MoreLink playlist={playlist} label={`All ${songs(total(playlist))}`} />}
    </div>
  );
}

const nextRun = (slot: { weekday: number; hour: number }) => `${WEEKDAYS[slot.weekday - 1]} at ${fmtHour(slot.hour)}`;

/** This week's picks with Claude's reason for each; with none yet, whether Claude is choosing them, can, or when it will. */
function PicksBody({ playlist, week }: { playlist: LivingPlaylist; week: PicksWeek }) {
  const status = useStatus();
  const gate = useClaudeGate({ needsSpotify: true });
  const queryClient = useQueryClient();
  const run = useRun<PicksWeek>({ key: "/api/picks/generate", onDone: () => void queryClient.invalidateQueries({ queryKey: ["picks"] }) });
  if (week.picks.length > 0)
    return (
      <div className="flex flex-col gap-2">
        <PickPreviews picks={week.picks.slice(0, 3)} />
        {week.picks.length > 3 && <MoreLink playlist={playlist} label={`All ${fmtInt(week.picks.length)} picks`} />}
      </div>
    );
  const schedule = status.data?.llm.schedule;
  const text = run.running
    ? "Claude is choosing this week’s picks."
    : (run.problem ?? gate.blocked ?? (schedule?.enabled ? `No picks yet this week. Claude picks them on ${nextRun(schedule.picks)}.` : "No picks yet this week."));
  return (
    <p className={cx("text-pretty", run.problem ? "text-danger" : "text-secondary")}>
      {text}
      {!gate.blocked && (
        <>
          {" "}
          <AppLink
            to={playlistPath(playlist.kind)}
            className="font-medium text-primary underline decoration-line-strong underline-offset-2 hover:decoration-current"
          >
            {run.running ? "Follow it on Weekly picks" : "Pick them now on Weekly picks"}
          </AppLink>
        </>
      )}
    </p>
  );
}

function PicksBand({ playlist, news }: { playlist: LivingPlaylist; news: string | null }) {
  const q = usePicks();
  return (
    <Band playlist={playlist} news={news} size="lead">
      {q.isError ? <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <RowSkeleton rows={3} /> : <PicksBody playlist={playlist} week={q.data} />}
    </Band>
  );
}

/** New from your artists: the releases themselves, newest first, then the songs it holds. */
function ReleasesBand({ playlist, news }: { playlist: LivingListItem; news: string | null }) {
  const q = useRadar("new");
  const releases = q.data?.items.slice(0, 4) ?? [];
  if (q.data && releases.length === 0 && playlist.songs.length === 0) return <EmptyBand playlist={playlist} news={news} />;
  return (
    <Band playlist={playlist} news={news} size="full">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={3} />
      ) : releases.length === 0 ? (
        <Songs playlist={playlist} />
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col">
            {releases.map((r) => (
              <ReleaseRow key={r.id} release={r} view="recent" onSeen={() => undefined} busy={false} />
            ))}
          </ul>
          {q.data.items.length > releases.length && <MoreLink playlist={playlist} label={`All ${fmtInt(q.data.items.length)} releases`} />}
        </div>
      )}
    </Band>
  );
}

const LOOK_BACK: LivingKind[] = ["forgotten", "this-month", "this-year"];
const ORDER: LivingKind[] = ["picks", "new-releases", "most-played", ...LOOK_BACK];

function PlaylistBand({ playlist, news }: { playlist: LivingListItem; news: string | null }) {
  if (playlist.kind === "picks") return <PicksBand playlist={playlist} news={news} />;
  if (playlist.kind === "new-releases") return <ReleasesBand playlist={playlist} news={news} />;
  if (playlist.songs.length === 0) return <EmptyBand playlist={playlist} news={news} />;
  const look = LOOK_BACK.includes(playlist.kind);
  return (
    <Band playlist={playlist} news={news} size={look ? "look" : "full"}>
      <Songs playlist={playlist} rank={!look} columns={look} />
    </Band>
  );
}

function recapDetail(p: SavedRecapPlaylist): string {
  if (p.source === "living") return `Kept when ${p.label} ended`;
  return `Saved from its recap, ${fmtDay(p.savedAt.slice(0, 10))}`;
}

/** Playlists of a period, saved from a recap or kept when a year ended: each opens its recap, or Spotify. */
function FromRecaps() {
  const q = useRecapPlaylists();
  if (q.isError) return <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <Section title="From your recaps">
      <ul className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        {items.map((p) => (
          <li key={`${p.kind}:${p.key}`} className="group relative -mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-fill">
            <AppLink to={recapPath(p.kind, p.key)} className="absolute inset-0 rounded-md" aria-label={`${p.label}, ${recapDetail(p)}`} />
            <Artwork src={p.coverUrl} kind="playlist" box={40} className="pointer-events-none" />
            <span className="pointer-events-none flex min-w-0 flex-1 flex-col">
              <span className="truncate text-primary">{p.label}</span>
              <span className="truncate text-caption text-secondary">{recapDetail(p)}</span>
            </span>
            <a href={p.url} target="_blank" rel="noreferrer" aria-label={`Open ${p.label} in Spotify`} title="Open in Spotify" className={iconButtonClass({ size: "sm", className: "relative shrink-0" })}>
              <Icon icon={ArrowUpRightIcon} size="sm" />
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function BandsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-12">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 md:gap-8">
          <Skeleton className={cx("aspect-square shrink-0 rounded-md", i === 0 ? "w-40 phone:w-16" : "w-28 phone:w-16")} />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
            <div className="mt-3">
              <RowSkeleton rows={3} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Bands({ list }: { list: LivingList }) {
  const news = useNews();
  const byKind = new Map(list.items.map((p) => [p.kind, p]));
  return (
    <div className="flex flex-col gap-12 md:gap-14">
      {ORDER.map((kind) => {
        const p = byKind.get(kind);
        return p ? <PlaylistBand key={kind} playlist={p} news={news[kind] ?? null} /> : null;
      })}
    </div>
  );
}

/**
 * For you: what encore made for the owner, each playlist as a band of what is in it. Weekly picks leads with Claude's
 * reasons; New from your artists shows the releases; Most played lately is a ranking; the look backs are shorter. Each
 * band opens the playlist's page, where Keep in Spotify, the full list and its changes live.
 */
export function ForYou() {
  const q = useLiving();
  const lifetime = useLifetime();
  const d = q.data;
  const firstUse = lifetime.data !== undefined && !lifetime.data.firstPlayed;
  const noneOn = d ? d.items.every((p) => !p.enabled) : false;
  return (
    <Page>
      <PageHeader title="For you" />
      {firstUse ? (
        <FirstUseState icon={WaveformIcon} description="encore makes these playlists from what you play. Import your history or connect Spotify first." />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <BandsSkeleton />
      ) : (
        <>
          {gateNotice(d.spotify)}
          {noneOn && d.spotify.connected && d.spotify.canWrite && (
            <p className="text-secondary text-pretty">Open one and switch on Keep in Spotify to add it to your Spotify account. encore refills it from then on.</p>
          )}
          <div className={dimWhile(q.isFetching && !q.isLoading)}>
            <Bands list={d} />
          </div>
          <FromRecaps />
        </>
      )}
    </Page>
  );
}
