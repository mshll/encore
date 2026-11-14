import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, request } from "../api/client";
import { useLiving, useLivingPlaylist, useLivingRefresh, useTimezone } from "../api/queries";
import type { LivingChange, LivingDetail, LivingKind, LivingList, LivingOutcome, LivingPlaylist, LivingSong, LivingUpdate } from "../api/types";
import { FOR_YOU_TABS } from "../app/nav";
import { songPath } from "../app/paths";
import { fmtAgo, fmtDate, fmtDayShort, fmtInt } from "../lib/format";
import { showToast } from "../lib/toast";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button, buttonClass } from "../ui/Button";
import { Dialog, DialogClose } from "../ui/Dialog";
import { EntityHeader, EntityHeaderSkeleton } from "../ui/EntityHeader";
import { Icon } from "../ui/Icon";
import { ArrowUpRightIcon, PlaylistIcon } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { Page, PageHeader, SIDE_COLUMNS, Section, dimWhile, useDocumentTitle } from "../ui/Page";
import { Row, RowList, RowSkeleton } from "../ui/Rows";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";
import { Switch } from "../ui/Switch";
import { TabNav } from "../ui/TabNav";
import { cx } from "../ui/cx";

const KINDS: LivingKind[] = ["picks", "forgotten", "most-played", "new-releases", "this-month"];
const isKind = (value: string): value is LivingKind => (KINDS as string[]).includes(value);
const playlistPath = (kind: LivingKind) => `/for-you/playlists/${kind}`;
const songs = (n: number) => `${fmtInt(n)} ${n === 1 ? "song" : "songs"}`;

const NOTHING_YET: Record<LivingKind, string> = {
  picks: "Picks appear after the next weekly run.",
  forgotten: "Songs you played 10 times or more, then left for 90 days, appear here.",
  "most-played": "Songs you play at least twice in four weeks appear here.",
  "new-releases": "Songs appear here when Releases finds something new from artists you play.",
  "this-month": "Songs you played this month in an earlier year appear here.",
};

const EVENT_REFRESH: Partial<Record<LivingKind, string>> = {
  picks: "refreshes after each picks run",
  "new-releases": "refreshes when Releases finds something",
};

type Gate = LivingList["spotify"];

/** Kinds made of songs the owner has played, so each has a song page. */
const PLAYED_KINDS: LivingKind[] = ["forgotten", "most-played", "this-month"];

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

/** One line on what the playlist holds now and how fresh it is. */
function statusLine(p: LivingPlaylist): string {
  if (p.removedAt) return "Deleted in Spotify";
  if (!p.enabled) return p.available ? `Would start with ${songs(p.available)}` : "Nothing to put in it yet";
  if (p.status === "deferred") return "Waiting until it stops playing";
  if (p.status === "failed") return p.playlist ? "The last refresh failed" : "Could not be added to Spotify";
  if (!p.playlist) return "Not in Spotify yet";
  if (p.count === 0) return "Nothing to put in it yet";
  const updated = p.changedAt ? `updated ${fmtAgo(p.changedAt)}` : null;
  return [songs(p.count), updated].filter(Boolean).join(" · ");
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

function PlaylistRow({ playlist, gate }: { playlist: LivingPlaylist; gate: Gate }) {
  const action = useLivingAction(playlist.kind, playlist.name);
  const blocked = !gate.connected || !gate.canWrite;
  return (
    <li className="group relative -mx-2 flex items-center gap-4 rounded-md px-2 py-3 transition-colors duration-150 hover:bg-fill">
      <AppLink to={playlistPath(playlist.kind)} className="absolute inset-0 rounded-md" aria-label={playlist.name} />
      <Artwork src={playlist.coverUrl} kind="playlist" box={64} className="pointer-events-none" />
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium text-primary">{playlist.name}</span>
        <span className="text-caption text-pretty text-secondary">{playlist.about}</span>
        <span className={cx("text-caption text-pretty", playlist.status === "failed" || playlist.removedAt ? "text-danger" : "text-secondary")}>
          {statusLine(playlist)}
        </span>
      </div>
      <span className="relative flex shrink-0">
        <Switch
          checked={playlist.enabled}
          onChange={action.toggle}
          label={`Keep ${playlist.name} in Spotify`}
          disabled={action.busy !== null || (blocked && !playlist.enabled)}
        />
      </span>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden className="flex flex-col">
      {KINDS.map((k) => (
        <div key={k} className="flex items-center gap-4 py-3">
          <Skeleton className="size-16 rounded-md" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-5 w-8 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** For you: Playlists. The playlists encore keeps refilling in the owner's Spotify account: which are on, and how fresh. */
export function Playlists() {
  const q = useLiving();
  const d = q.data;
  const noneOn = d ? d.items.every((p) => !p.enabled) : false;
  return (
    <Page>
      <PageHeader title="For you">
        <TabNav items={FOR_YOU_TABS} label="For you" />
      </PageHeader>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <ListSkeleton />
      ) : (
        <section aria-label="Playlists" className="flex flex-col gap-4">
          {gateNotice(d.spotify)}
          {noneOn && <p className="text-secondary text-pretty">Switch one on and it appears in your Spotify account. encore refills it from then on.</p>}
          <ul className={cx("flex flex-col", dimWhile(q.isFetching && !q.isLoading))}>
            {d.items.map((p) => (
              <PlaylistRow key={p.kind} playlist={p} gate={d.spotify} />
            ))}
          </ul>
        </section>
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
  return (
    <div className="flex items-center gap-2 phone:grid phone:w-full phone:grid-cols-2">
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
        </div>
        <Changes playlist={p} />
      </div>
    </Page>
  );
}

/** One living playlist: its cover, on or off, what is in it now (or what it would start with), and every change. */
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
            <AppLink to="/for-you/playlists" className={buttonClass()}>
              Back to playlists
            </AppLink>
          }
        />
      </Page>
    );
  return <PlaylistDetail kind={kind} />;
}
