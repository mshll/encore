import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { ApiError, request } from "../api/client";
import { useDj, useSet } from "../api/queries";
import type { DjSession, SavedPlaylist, SetDetail, SetTrack } from "../api/types";
import { useOpenQueue } from "../app/Shell";
import { artistPath, songPath } from "../app/paths";
import { useChat } from "../chat/state";
import { assistantProblem } from "../lib/assistant";
import { fmtAgo, fmtInt } from "../lib/format";
import { showToast } from "../lib/toast";
import { openInSpotify, usePlayback } from "../player/playback";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button, buttonClass, IconButton } from "../ui/Button";
import { Confirm } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { ArrowUpRightIcon, ChatCircleTextIcon, MicrophoneStageIcon, MusicNoteIcon, PlayIcon, PlaylistIcon, PushPinIcon, QueueIcon, TrashIcon } from "../ui/icons";
import { MenuItem, MenuLinkItem, MenuPopup, MenuRoot, MenuSeparator, MoreTrigger } from "../ui/Menu";
import { EntityHeader, EntityHeaderSkeleton } from "../ui/EntityHeader";
import { Page, PageHeader, Section, useDocumentTitle } from "../ui/Page";
import { RowSkeleton } from "../ui/Rows";
import { EmptyState, ErrorState } from "../ui/States";

function TrackRow({ item, added, onPin, onRemove }: { item: SetTrack; added: boolean; onPin: () => void; onRemove: () => void }) {
  const playback = usePlayback();
  const [, navigate] = useLocation();
  const origin = item.kind === "new" ? "New to you" : item.history ? `${fmtInt(item.history.listens)} listens` : null;
  const played =
    item.dj.finished + item.dj.skipped > 0
      ? `In sessions: ${fmtInt(item.dj.finished)} played through, ${fmtInt(item.dj.skipped)} skipped`
      : item.outcome.plays > 0
        ? `Played ${fmtInt(item.outcome.plays)} ${item.outcome.plays === 1 ? "time" : "times"} since, ${fmtInt(item.outcome.finished)} played through`
        : null;
  return (
    <li className="group -mx-2 flex gap-3 rounded-md px-2 py-3 transition-colors duration-150 hover:bg-fill">
      <span className="w-5 shrink-0 pt-2.5 text-right text-caption text-tertiary tabular">{item.position}</span>
      <Artwork src={item.albumArtUrl} kind="song" box={40} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-primary">{item.name}</span>
          {item.pinned && (
            <span className="flex shrink-0 text-secondary">
              <Icon icon={PushPinIcon} />
              <span className="sr-only">Pinned</span>
            </span>
          )}
        </span>
        <span className="truncate text-caption text-secondary">
          {added && <span className="text-primary">Added · </span>}
          {item.artist}
          {origin && ` · ${origin}`}
        </span>
        <p className="mt-1 text-caption text-pretty text-secondary">{item.reason}</p>
        {played && <p className="mt-0.5 text-caption text-tertiary tabular">{played}</p>}
      </div>
      <span className="flex shrink-0 items-start md:can-hover:opacity-0 md:transition-opacity md:duration-150 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:has-[[data-open]]:opacity-100">
        <IconButton icon={PlayIcon} label={`Play ${item.name}`} size="sm" className="max-md:hidden" onClick={() => playback.play([item.uri])} />
        <MenuRoot>
          <MoreTrigger label={`More for ${item.name}`} />
          <MenuPopup>
            <MenuItem icon={PlayIcon} onClick={() => playback.play([item.uri])}>
              Play
            </MenuItem>
            <MenuItem icon={QueueIcon} onClick={() => playback.queue(item.uri, item.name)}>
              Add to queue
            </MenuItem>
            <MenuItem icon={PushPinIcon} onClick={onPin}>
              {item.pinned ? "Unpin" : "Pin through changes"}
            </MenuItem>
            <MenuSeparator />
            {item.kind === "library" && (
              <MenuItem icon={MusicNoteIcon} onClick={() => navigate(songPath(item.songKey))}>
                Go to song
              </MenuItem>
            )}
            <MenuItem icon={MicrophoneStageIcon} onClick={() => navigate(artistPath(item.artist))}>
              Go to artist
            </MenuItem>
            <MenuLinkItem icon={ArrowUpRightIcon} href={openInSpotify(item.uri)} target="_blank" rel="noreferrer">
              Open in Spotify
            </MenuLinkItem>
            <MenuSeparator />
            <MenuItem icon={TrashIcon} danger onClick={onRemove}>
              Remove from set
            </MenuItem>
          </MenuPopup>
        </MenuRoot>
      </span>
    </li>
  );
}

/** The DJ session started from this set: how far it got, Stop, and the queue where it plays. */
function SessionLine({ session }: { session: DjSession }) {
  const queryClient = useQueryClient();
  const openQueue = useOpenQueue();
  const stop = useMutation({
    mutationFn: () => request("/api/dj/stop", { json: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dj"] }),
    onError: () => showToast("The session could not be stopped. Try again.", "problem"),
  });
  const skipped = session.played.filter((p) => p.outcome === "skipped").length;
  const replanned = session.replans > 0 ? `, re-planned ${session.replans === 1 ? "once" : `${fmtInt(session.replans)} times`} after skips` : "";
  return (
    <div role="status" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <p className="text-pretty">
        Playing as a session: <span className="tabular">{fmtInt(session.played.length)}</span> played, <span className="tabular">{fmtInt(skipped)}</span>{" "}
        skipped, <span className="tabular">{fmtInt(session.upcoming.length)}</span> to go{replanned}.
      </p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={openQueue}>
          Show queue
        </Button>
        <Button size="sm" busy={stop.isPending} busyLabel="Stopping" onClick={() => stop.mutate()}>
          Stop
        </Button>
      </div>
    </div>
  );
}

function savedMessage(updated: boolean, cover: SavedPlaylist["cover"]["status"]): string {
  const base = updated ? "Playlist updated in Spotify" : "Saved to Spotify as a private playlist";
  if (cover === "failed") return `${base}, without its cover.`;
  if (cover === "missing_scope") return `${base}. Connect Spotify again in Settings to add its cover.`;
  return `${base}.`;
}

function SetActions({ set, playing, converse }: { set: SetDetail; playing: boolean; converse: ReactNode }) {
  const queryClient = useQueryClient();
  const openQueue = useOpenQueue();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState<"save" | "play" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const act = async (kind: "save" | "play" | "delete", work: () => Promise<void>) => {
    setBusy(kind);
    try {
      await work();
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    } finally {
      setBusy(null);
    }
  };
  const save = () =>
    act("save", async () => {
      const saved = await request<SavedPlaylist>(`/api/sets/${set.id}/playlist`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["sets"] });
      showToast(savedMessage(Boolean(set.playlist), saved.cover.status));
    });
  const play = () =>
    act("play", async () => {
      await request(`/api/sets/${set.id}/play`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["dj"] });
      openQueue();
    });
  const remove = () =>
    act("delete", async () => {
      await request(`/api/sets/${set.id}`, { method: "DELETE" });
      queryClient.removeQueries({ queryKey: ["sets", set.id] });
      await queryClient.invalidateQueries({ queryKey: ["sets"] });
      navigate("/sets");
    });
  const empty = set.items.length === 0;
  return (
    <div className="flex items-center gap-2 max-lg:grid max-lg:w-full max-lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:max-lg:flex">
      {!playing && (
        <Button
          variant="accent"
          icon={PlayIcon}
          disabled={empty || busy !== null}
          busy={busy === "play"}
          busyLabel="Starting"
          onClick={play}
          className="max-lg:col-span-3"
        >
          Play as a session
        </Button>
      )}
      {converse}
      {!set.playlist || set.playlist.outdated ? (
        <Button disabled={empty || busy !== null} busy={busy === "save"} busyLabel="Saving" onClick={save}>
          {set.playlist ? "Update playlist" : "Save to Spotify"}
        </Button>
      ) : (
        <a className={buttonClass()} href={set.playlist.url} target="_blank" rel="noreferrer">
          Open playlist
        </a>
      )}
      <MenuRoot>
        <MoreTrigger label="More for this set" size="md" />
        <MenuPopup>
          {set.playlist && (
            <MenuLinkItem icon={ArrowUpRightIcon} href={set.playlist.url} target="_blank" rel="noreferrer">
              Open playlist in Spotify
            </MenuLinkItem>
          )}
          <MenuItem icon={TrashIcon} danger onClick={() => setConfirmDelete(true)}>
            Delete set
          </MenuItem>
        </MenuPopup>
      </MenuRoot>
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${set.title}”?`}
        action="Delete"
        danger
        busy={busy === "delete"}
        onConfirm={remove}
      >
        {set.playlist ? "The set and its conversation are deleted. The playlist stays in your Spotify account." : "The set and its conversation are deleted."}
      </Confirm>
    </div>
  );
}

function summary(set: SetDetail): string {
  const fromLibrary = set.items.filter((i) => i.kind === "library").length;
  const fresh = set.items.length - fromLibrary;
  return [
    `${fmtInt(set.items.length)} songs: ${fmtInt(fromLibrary)} you know, ${fmtInt(fresh)} new to you`,
    set.playlist && (set.playlist.outdated ? "changed since you saved it" : "saved to Spotify"),
    `updated ${fmtAgo(set.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function SetSkeleton() {
  return (
    <Page crumb={undefined}>
      <EntityHeaderSkeleton />
      <RowSkeleton rows={8} rank />
    </Page>
  );
}

/** One set: its songs with the reasons and the session it plays as. Its conversation is in the chat, opened by Change. */
export function SetPage({ id }: { id: number }) {
  const q = useSet(id);
  const dj = useDj();
  const queryClient = useQueryClient();
  const chat = useChat();
  const [removing, setRemoving] = useState<SetTrack | null>(null);
  useDocumentTitle(q.data?.title ?? "Set");

  const replace = (set: SetDetail) => {
    queryClient.setQueryData(["sets", id], set);
    void queryClient.invalidateQueries({ queryKey: ["sets"], exact: true });
  };
  const edit = async (item: SetTrack, init: RequestInit & { json?: unknown }) => {
    try {
      replace(await request<SetDetail>(`/api/sets/${id}/items/${item.position}`, init));
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    }
  };

  if (q.isError)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <Page crumb={null}>
        <PageHeader title="Set" />
        <EmptyState
          size="page"
          icon={PlaylistIcon}
          title="This set does not exist"
          action={
            <AppLink to="/sets" className={buttonClass()}>
              Back to sets
            </AppLink>
          }
        />
      </Page>
    ) : (
      <Page crumb={null}>
        <PageHeader title="Set" />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Page>
    );
  if (!q.data) return <SetSkeleton />;

  const set = q.data;
  const latest = set.changes.at(-1);
  const current = latest && latest.version === set.version && latest.source === "claude" ? latest : null;
  const added = new Set(current?.added.map((t) => t.songKey));
  const session = dj.data?.session;
  const playing = session?.status === "active" && session.set?.id === set.id ? session : null;
  const asking = set.version === 0;
  const converse = (
    <Button icon={ChatCircleTextIcon} onClick={() => chat.show({ thread: { kind: "set", id: set.id } })}>
      {chat.runningFor({ kind: "set", id: set.id }) ? "Changing…" : asking ? "Answer" : "Change"}
    </Button>
  );

  return (
    <Page crumb={set.title}>
      <div className="flex min-w-0 flex-col gap-10 md:gap-12">
          <EntityHeader
            title={set.title}
            art={set.coverUrl}
            kind="playlist"
            credits={set.description || undefined}
            detail={set.items.length > 0 ? summary(set) : undefined}
            actions={<SetActions set={set} playing={Boolean(playing)} converse={converse} />}
          />
          {playing && (
            <div className="-mt-6 md:-mt-8">
              <SessionLine session={playing} />
            </div>
          )}
          <Section title="Songs">
            {set.items.length === 0 ? (
              <EmptyState icon={PlaylistIcon} title="No songs yet" description="Answer Claude’s question to build the set." />
            ) : (
              <ol className="flex flex-col">
                {set.items.map((item) => (
                  <TrackRow
                    key={item.songKey}
                    item={item}
                    added={added.has(item.songKey)}
                    onPin={() => edit(item, { method: "PATCH", json: { pinned: !item.pinned } })}
                    onRemove={() => setRemoving(item)}
                  />
                ))}
              </ol>
            )}
          </Section>
      </div>
      <Confirm
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove “${removing?.name ?? ""}”?`}
        action="Remove"
        danger
        onConfirm={() => {
          if (removing) void edit(removing, { method: "DELETE" });
          setRemoving(null);
        }}
      >
        {set.playlist ? "The set and its Spotify playlist get a new version without it." : "The set gets a new version without it."}
      </Confirm>
    </Page>
  );
}
