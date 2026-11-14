import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, get, request } from "../api/client";
import { useLifetime, useLiving, useLivingPlaylist, useLivingRefresh, usePicks, useRadar, useTimezone } from "../api/queries";
import type { LivingChange, LivingDetail, LivingKind, LivingList, LivingOutcome, LivingPlaylist, LivingSong, LivingUpdate } from "../api/types";
import { songPath } from "../app/paths";
import { fmtAgo, fmtDate, fmtDayShort, fmtInt } from "../lib/format";
import { showToast } from "../lib/toast";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button, buttonClass, IconButton } from "../ui/Button";
import { Dialog, DialogClose } from "../ui/Dialog";
import { EntityHeader, EntityHeaderSkeleton } from "../ui/EntityHeader";
import { Icon } from "../ui/Icon";
import { ArrowUpRightIcon, PlayIcon, PlaylistIcon, WaveformIcon } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { Page, PageHeader, SIDE_COLUMNS, Section, dimWhile, useDocumentTitle } from "../ui/Page";
import { Row, RowList, RowSkeleton } from "../ui/Rows";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { Switch } from "../ui/Switch";
import { cx } from "../ui/cx";
import { usePlayback } from "../player/playback";
import { WeeklyPicks } from "./Picks";
import { ReleasesSection } from "./Releases";

const KINDS: LivingKind[] = ["picks", "forgotten", "most-played", "new-releases", "this-month", "this-year"];
const isKind = (value: string): value is LivingKind => (KINDS as string[]).includes(value);
export const playlistPath = (kind: LivingKind) => `/for-you/${kind}`;
const songs = (n: number) => `${fmtInt(n)} ${n === 1 ? "song" : "songs"}`;

const NOTHING_YET: Record<LivingKind, string> = {
  picks: "Picks appear after the next weekly run.",
  forgotten: "Songs you played 10 times or more, then left for 90 days, appear here.",
  "most-played": "Songs you play at least twice in four weeks appear here.",
  "new-releases": "Songs appear here when an artist you play releases something new.",
  "this-month": "Songs you played this month in an earlier year appear here.",
  "this-year": "Songs you play at least twice this year appear here.",
};

const EVENT_REFRESH: Partial<Record<LivingKind, string>> = {
  picks: "refreshes after each picks run",
  "new-releases": "refreshes when an artist you play releases something",
};

type Gate = LivingList["spotify"];

/** Kinds made of songs the owner has played, so each has a song page. */
const PLAYED_KINDS: LivingKind[] = ["forgotten", "most-played", "this-month", "this-year"];

/** A song in a living playlist: the shared row with play and the song menu. */
function SongRow({ song, rank, kind }: { song: LivingSong; rank: number; kind: LivingKind }) {
  return (
    <Row
      to={PLAYED_KINDS.includes(kind) ? songPath(song.songKey) : undefined}
      title={song.name}
      subtitle={song.artist}
      art={{ src: song.albumArtUrl, kind: "song" }}
      rank={rank}
      song={{ uri: song.uri, name: song.name, songKey: song.songKey, artist: song.artist }}
    />
  );
}

/** Why switching on or refreshing cannot work right now, if anything. */
function gateNotice(gate: Gate) {
  if (!gate.connected)
    return (
      <Notice
        tone="warning"
        action={
          <AppLink to="/settings/spotify" className={buttonClass({ size: "sm" })}>
            Open Spotify settings
          </AppLink>
        }
      >
        Connect Spotify to keep these playlists in your account.
      </Notice>
    );
  if (!gate.canWrite)
    return (
      <Notice
        tone="warning"
        action={
          <AppLink to="/settings/spotify" className={buttonClass({ size: "sm" })}>
            Open Spotify settings
          </AppLink>
        }
      >
        encore is not allowed to change playlists yet. Connect Spotify again to allow it.
      </Notice>
    );
  return null;
}

function nextLine(p: LivingPlaylist): string | null {
  if (!p.enabled) return null;
  if (EVENT_REFRESH[p.kind]) return EVENT_REFRESH[p.kind]!;
  return p.nextRefresh ? `next refresh ${fmtDayShort(p.nextRefresh)}` : null;
}

function outcomeMessage(o: LivingOutcome, name: string, enabling: boolean): { text: string; problem: boolean } {
  const cover = o.cover === "missing_scope" ? " Connect Spotify again in Settings to add its cover." : o.cover === "failed" ? " Its cover was not added; it is tried again on the next refresh." : "";
  switch (o.status) {
    case "off":
      return { text: `${name} is off. The playlist stays in Spotify as it is.`, problem: false };
    case "refreshed":
      return { text: `${enabling ? `${name} is in your Spotify account.` : `${name} is updated in Spotify.`}${cover}`, problem: false };
    case "unchanged":
      return { text: `${name} is already up to date.${cover}`, problem: false };
    case "empty":
      return { text: enabling ? `${name} is in your Spotify account, empty for now.${cover}` : `Nothing new to put in ${name}.`, problem: false };
    case "deferred":
      return { text: `${name} is playing now. The refresh waits until it stops.`, problem: false };
    case "removed":
      return { text: `${name} was deleted in Spotify. Switch it on to make a new one.`, problem: true };
    case "failed":
      return { text: `Spotify did not take the change to ${name}. It is tried again within the hour.`, problem: true };
  }
}

function requestProblem(error: unknown): string {
  if (error instanceof ApiError && error.code === "spotify_not_connected") return "Connect Spotify first.";
  if (error instanceof ApiError && error.code === "missing_scope") return "Connect Spotify again in Settings to allow playlist changes.";
  return "Could not reach encore. Try again.";
}

/** Switch on or off, or refresh now; keeps the list and the playlist's page in step. */
function useLivingAction(kind: LivingKind, name: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"toggle" | "refresh" | null>(null);
  const run = async (what: "toggle" | "refresh", init: { path: string; method: string; json?: unknown }, enabling: boolean) => {
    setBusy(what);
    try {
      const update = await request<LivingUpdate>(init.path, { method: init.method, ...(init.json === undefined ? {} : { json: init.json }) });
      queryClient.setQueryData(["living", kind], update.playlist);
      await queryClient.invalidateQueries({ queryKey: ["living"], exact: true });
      const message = outcomeMessage(update.outcome, name, enabling);
      showToast(message.text, message.problem ? "problem" : "info");
    } catch (error) {
      showToast(requestProblem(error), "problem");
    } finally {
      setBusy(null);
    }
  };
  return {
    busy,
    toggle: (enabled: boolean) => run("toggle", { path: `/api/living/${kind}`, method: "PATCH", json: { enabled } }, enabled),
    refresh: () => run("refresh", { path: `/api/living/${kind}/refresh`, method: "POST" }, false),
  };
}

/** The line under a cover: a problem first, then what is new, then how fresh it is. */
function freshLine(p: LivingPlaylist, news: string | null): { text: string; problem: boolean } {
  if (p.removedAt) return { text: "Deleted in Spotify", problem: true };
  if (p.enabled && p.status === "failed") return { text: p.playlist ? "The last refresh failed" : "Could not be added to Spotify", problem: true };
  if (news) return { text: news, problem: false };
  if (!p.enabled) return { text: p.available ? `${songs(p.available)}, not in Spotify` : "Nothing in it yet", problem: false };
  if (!p.playlist) return { text: "Not in Spotify yet", problem: false };
  if (p.status === "deferred") return { text: "Waits until it stops playing", problem: false };
  return { text: p.changedAt ? `Updated ${fmtAgo(p.changedAt)}` : songs(p.count), problem: false };
}

const playable = (p: LivingPlaylist) => (p.enabled && p.playlist ? p.count : p.available) > 0;

/** Plays the playlist in Spotify when it is there, otherwise the songs encore would put in it. */
function usePlayPlaylist() {
  const playback = usePlayback();
  const queryClient = useQueryClient();
  return async (p: LivingPlaylist) => {
    if (p.enabled && p.playlist) return void (await playback.playContext(`spotify:playlist:${p.playlist.id}`));
    try {
      const detail = await queryClient.fetchQuery({ queryKey: ["living", p.kind], queryFn: () => get<LivingDetail>(`/api/living/${p.kind}`) });
      const uris = (detail.items.length ? detail.items : detail.preview).map((s) => s.uri);
      if (uris.length) await playback.play(uris);
    } catch (error) {
      showToast(requestProblem(error), "problem");
    }
  };
}

function Cover({ playlist, news, shelf }: { playlist: LivingPlaylist; news: string | null; shelf: boolean }) {
  const play = usePlayPlaylist();
  const line = freshLine(playlist, news);
  return (
    <li className={cx("group relative flex min-w-0 flex-col", shelf && "phone:shrink-0 phone:basis-2/5 phone:snap-start")}>
      <AppLink to={playlistPath(playlist.kind)} className="flex min-w-0 flex-col gap-3 rounded-md">
        <Artwork src={playlist.coverUrl} kind="playlist" box="fill" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium text-primary">{playlist.name}</span>
          <span className={cx("text-caption text-pretty", line.problem ? "text-danger" : news ? "text-primary" : "text-secondary")}>{line.text}</span>
        </span>
      </AppLink>
      {playable(playlist) && (
        <IconButton
          icon={PlayIcon}
          fill
          label={`Play ${playlist.name}`}
          variant="accent"
          size="lg"
          onClick={() => void play(playlist)}
          className="absolute top-[calc(100%-theme(spacing.3))] right-3 rounded-full opacity-0 shadow-overlay transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 phone:hidden"
        />
      )}
    </li>
  );
}

export function CoversSkeleton() {
  return (
    <div aria-hidden className={COVERS}>
      {KINDS.map((k) => (
        <div key={k} className="flex flex-col gap-3">
          <Skeleton className="aspect-square w-full rounded-md" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

const COVERS = "grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 md:gap-x-6 xl:grid-cols-6";

/** What is new in a playlist that has its own source of news: this week's unopened picks, unseen releases. */
function useNews(): Partial<Record<LivingKind, string>> {
  const picks = usePicks();
  const radar = useRadar("new");
  const newPicks = picks.data?.picks.filter((p) => p.state === "new").length ?? 0;
  const releases = radar.data?.unseenNew ?? 0;
  return {
    ...(newPicks > 0 && { picks: `${fmtInt(newPicks)} new ${newPicks === 1 ? "pick" : "picks"} this week` }),
    ...(releases > 0 && { "new-releases": `${fmtInt(releases)} new ${releases === 1 ? "release" : "releases"}` }),
  };
}

/** One row a phone scrolls sideways (Home), where a grid would push everything else down. */
const SHELF = "phone:-mx-(--gutter) phone:flex phone:snap-x phone:snap-mandatory phone:scroll-px-(--gutter) phone:overflow-x-auto phone:px-(--gutter) phone:no-scrollbar";

/** The playlists encore makes, by cover: what is in each and how fresh. `shelf`: one sideways row on a phone (Home). */
export function PlaylistCovers({ list, shelf = false }: { list: LivingList; shelf?: boolean }) {
  const news = useNews();
  return (
    <ul className={cx(COVERS, shelf && SHELF)}>
      {list.items.map((p) => (
        <Cover key={p.kind} playlist={p} news={news[p.kind] ?? null} shelf={shelf} />
      ))}
    </ul>
  );
}

/** For you: what encore made for the owner, by cover. Each opens its playlist; Keep in Spotify is the switch there. */
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
        <CoversSkeleton />
      ) : (
        <>
          {gateNotice(d.spotify)}
          {noneOn && d.spotify.connected && d.spotify.canWrite && (
            <p className="text-secondary text-pretty">Open one and switch on Keep in Spotify to add it to your Spotify account. encore refills it from then on.</p>
          )}
          <div className={dimWhile(q.isFetching && !q.isLoading)}>
            <PlaylistCovers list={d} />
          </div>
        </>
      )}
    </Page>
  );
}

function changeLine(change: LivingChange, first: boolean): string {
  if (first && change.removed.length === 0) return `Started with ${songs(change.count)}`;
  const parts = [change.added.length > 0 && `added ${fmtInt(change.added.length)}`, change.removed.length > 0 && `removed ${fmtInt(change.removed.length)}`].filter(Boolean);
  const text = parts.length ? parts.join(", ") : "same songs";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ChangeDialog({ kind, change, onClose }: { kind: LivingKind; change: LivingChange | null; onClose: () => void }) {
  const timezone = useTimezone();
  const q = useLivingRefresh(kind, change?.id ?? null);
  const removed = q.data?.removed ?? [];
  return (
    <Dialog
      open={change !== null}
      onOpenChange={(open) => !open && onClose()}
      title={change ? `As of ${fmtDate(change.at, timezone)}` : ""}
      description={change && q.data ? songs(q.data.items.length) : undefined}
      footer={<DialogClose className={buttonClass()}>Close</DialogClose>}
    >
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} size="inline" />
      ) : !q.data ? (
        <RowSkeleton rows={6} rank />
      ) : (
        <div className="flex flex-col gap-5">
          {q.data.items.length > 0 ? (
            <RowList label="Songs">
              {q.data.items.map((s, i) => (
                <SongRow key={s.uri} song={s} rank={i + 1} kind={kind} />
              ))}
            </RowList>
          ) : (
            <p className="text-secondary">It was empty.</p>
          )}
          {removed.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="font-medium text-primary">Removed</h3>
              <p className="text-secondary text-pretty">{removed.map((s) => `${s.name} (${s.artist})`).join(", ")}</p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Changes({ playlist }: { playlist: LivingDetail }) {
  const timezone = useTimezone();
  const [open, setOpen] = useState<LivingChange | null>(null);
  const oldest = playlist.history.at(-1);
  return (
    <Section title="Changes">
      {playlist.history.length === 0 ? (
        <p className="text-secondary">No changes yet.</p>
      ) : (
        <ol className="flex flex-col">
          {playlist.history.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => setOpen(h)}
                className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors duration-150 hover:bg-fill"
              >
                <span className="text-primary">{fmtDate(h.at, timezone)}</span>
                <span className="text-caption text-secondary">
                  {changeLine(h, h.id === oldest?.id || !h.current)}
                  {!h.current && " · earlier playlist"}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <ChangeDialog kind={playlist.kind} change={open} onClose={() => setOpen(null)} />
    </Section>
  );
}

function detailLine(p: LivingDetail, timezone: string): string | undefined {
  if (p.enabled && !p.playlist) return "Not in Spotify yet";
  const parts: string[] = [];
  if (p.playlist && p.count > 0) parts.push(songs(p.count));
  if (p.playlist && p.changedAt) parts.push(`updated ${fmtDate(p.changedAt, timezone)}`);
  const next = nextLine(p);
  if (next) parts.push(next);
  const line = parts.join(" · ");
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : undefined;
}

function StateNotice({ playlist, onRetry }: { playlist: LivingDetail; onRetry: () => void }) {
  const timezone = useTimezone();
  if (playlist.removedAt) return <Notice tone="warning">Deleted in Spotify on {fmtDate(playlist.removedAt, timezone)}. Switch it on to make a new one.</Notice>;
  if (!playlist.enabled) return null;
  if (playlist.status === "failed")
    return (
      <Notice tone="danger" onRetry={onRetry}>
        {playlist.playlist ? "The last refresh failed. It is tried again within the hour." : "It could not be added to Spotify. It is tried again within the hour."}
      </Notice>
    );
  if (playlist.status === "deferred") return <Notice>It is playing now, so the refresh waits until it stops.</Notice>;
  if (playlist.status === "empty" && playlist.count > 0) return <Notice>Nothing new to put in it, so it keeps the songs below.</Notice>;
  return null;
}

type LivingAction = ReturnType<typeof useLivingAction>;

function PlaylistActions({ playlist, gate, action }: { playlist: LivingDetail; gate: Gate | undefined; action: LivingAction }) {
  const blocked = gate ? !gate.connected || !gate.canWrite : false;
  const switchId = `living-${playlist.kind}`;
  const play = usePlayPlaylist();
  return (
    <div className="flex flex-wrap items-center gap-2 phone:grid phone:w-full phone:grid-cols-2">
      {playable(playlist) && (
        <Button variant="accent" icon={PlayIcon} onClick={() => void play(playlist)} className="phone:col-span-2">
          Play
        </Button>
      )}
      <span className="flex min-h-(--control-h) items-center gap-2 pr-2 phone:col-span-2">
        <Switch id={switchId} checked={playlist.enabled} onChange={action.toggle} label="Keep in Spotify" disabled={action.busy !== null || (blocked && !playlist.enabled)} />
        <label htmlFor={switchId} className="text-primary">
          Keep in Spotify
        </label>
      </span>
      {playlist.enabled && (
        <Button busy={action.busy === "refresh"} busyLabel="Refreshing" disabled={action.busy !== null || blocked} onClick={action.refresh}>
          Refresh now
        </Button>
      )}
      {playlist.playlist && (
        <a className={buttonClass({ className: "gap-1.5" })} href={playlist.playlist.url} target="_blank" rel="noreferrer">
          Open in Spotify
          <Icon icon={ArrowUpRightIcon} size="sm" className="opacity-70" />
        </a>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <Page>
      <div className={SIDE_COLUMNS}>
        <div className="flex flex-col gap-10">
          <EntityHeaderSkeleton />
          <RowSkeleton rows={8} rank />
        </div>
      </div>
    </Page>
  );
}

function PlaylistDetail({ kind }: { kind: LivingKind }) {
  const q = useLivingPlaylist(kind);
  const list = useLiving();
  const timezone = useTimezone();
  const action = useLivingAction(kind, q.data?.name ?? "");
  useDocumentTitle(q.data?.name ?? "Playlist");

  if (q.isError)
    return (
      <Page crumb={null}>
        <PageHeader title="Playlist" />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Page>
    );
  if (!q.data) return <DetailSkeleton />;

  const p = q.data;
  const shown = p.items.length ? p.items : p.preview;
  const gate = list.data?.spotify;
  return (
    <Page crumb={p.name}>
      <div className={SIDE_COLUMNS}>
        <div className="flex min-w-0 flex-col gap-10 md:gap-12">
          <EntityHeader
            title={p.name}
            art={p.coverUrl}
            kind="playlist"
            credits={p.about}
            detail={detailLine(p, timezone)}
            actions={<PlaylistActions playlist={p} gate={gate} action={action} />}
          />
          {gate && gateNotice(gate)}
          <StateNotice playlist={p} onRetry={action.refresh} />
          {kind === "picks" ? (
            <WeeklyPicks />
          ) : (
            <>
              {kind === "new-releases" && <ReleasesSection />}
              <Section title={p.items.length || p.playlist ? "In the playlist" : p.enabled ? "It will start with" : "It would start with"} description={!p.items.length && shown.length ? songs(shown.length) : undefined}>
                {shown.length === 0 ? (
                  <EmptyState icon={PlaylistIcon} title="Nothing to put in it yet" description={NOTHING_YET[kind]} />
                ) : (
                  <RowList label={p.name} className={dimWhile(q.isFetching)}>
                    {shown.map((s, i) => (
                      <SongRow key={s.uri} song={s} rank={i + 1} kind={kind} />
                    ))}
                  </RowList>
                )}
              </Section>
            </>
          )}
        </div>
        <Changes playlist={p} />
      </div>
    </Page>
  );
}

/**
 * One playlist encore makes: its cover, Play, Keep in Spotify, what is in it now (or what it would start with), and every
 * change. Weekly picks holds the picks with Claude's reasons; New from your artists holds the releases above its songs.
 */
export function PlaylistPage({ kind }: { kind: string }) {
  if (!isKind(kind))
    return (
      <Page crumb={null}>
        <PageHeader title="Playlist" />
        <EmptyState
          size="page"
          icon={PlaylistIcon}
          title="This playlist does not exist"
          action={
            <AppLink to="/for-you" className={buttonClass()}>
              Open For you
            </AppLink>
          }
        />
      </Page>
    );
  return <PlaylistDetail kind={kind} />;
}
