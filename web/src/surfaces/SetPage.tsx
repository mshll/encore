import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { ApiError, request } from "../api/client";
import { useDj, useSet } from "../api/queries";
import type { DjSession, SetChange, SetDetail, SetResult, SetTrack } from "../api/types";
import { useOpenQueue } from "../app/Shell";
import { artistPath, songPath } from "../app/paths";
import { assistantProblem } from "../lib/assistant";
import { fmtAgo, fmtInt } from "../lib/format";
import { showToast } from "../lib/toast";
import { useRun } from "../lib/useRun";
import { openInSpotify, usePlayback } from "../player/playback";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button, buttonClass, IconButton } from "../ui/Button";
import { RunNotice, useClaudeGate } from "../ui/ClaudeNotice";
import { Composer } from "../ui/Composer";
import { Confirm } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { ArrowUpRightIcon, DotsThreeIcon, MusicNotesIcon, PlayIcon, PlaylistIcon, PushPinIcon, QueueIcon, TrashIcon, VinylRecordIcon } from "../ui/icons";
import { MenuItem, MenuLinkItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "../ui/Menu";
import { Page, PageHeader, Section } from "../ui/Page";
import { RowSkeleton } from "../ui/Rows";
import { RunProgress } from "../ui/RunProgress";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";

const names = (tracks: { name: string }[]) => tracks.map((t) => t.name).join(", ");

function changeLines(change: SetChange): string[] {
  if (change.source === "owner") return change.removed.length ? [`You removed ${names(change.removed)}.`] : [];
  const lines = [
    change.added.length > 0 && `Added ${names(change.added)}.`,
    change.removed.length > 0 && `Removed ${names(change.removed)}.`,
    change.moved.length > 0 && `Moved ${change.moved.map((m) => `${m.name} from ${m.from} to ${m.to}`).join(", ")}.`,
  ].filter((l): l is string => Boolean(l));
  return lines.length ? lines : ["Same songs, new order or reasons."];
}

type Entry = { kind: "turn"; role: "owner" | "assistant"; text: string } | { kind: "change"; change: SetChange };

/** The conversation with each version change placed after the message that asked for it; owner edits in order. */
function timeline(set: SetDetail): Entry[] {
  const pending = [...set.changes];
  const out: Entry[] = [];
  const flushOwnerBefore = (version: number) => {
    while (pending[0] && pending[0].source === "owner" && pending[0].version < version) out.push({ kind: "change", change: pending.shift()! });
  };
  set.conversation.forEach((turn, i) => {
    const match = turn.role === "owner" && i > 0 ? pending.findIndex((c) => c.source === "claude" && c.message === turn.text) : -1;
    if (match >= 0) flushOwnerBefore(pending[match]!.version);
    out.push({ kind: "turn", role: turn.role, text: turn.text });
    const idx = turn.role === "owner" && i > 0 ? pending.findIndex((c) => c.source === "claude" && c.message === turn.text) : -1;
    if (idx >= 0) out.push({ kind: "change", change: pending.splice(idx, 1)[0]! });
  });
  for (const change of pending) out.push({ kind: "change", change });
  return out;
}

function TrackRow({ item, added, onPin, onRemove }: { item: SetTrack; added: boolean; onPin: () => void; onRemove: () => void }) {
  const playback = usePlayback();
  const [, navigate] = useLocation();
  const origin = item.kind === "new" ? "New to you" : item.history ? `${fmtInt(item.history.listens)} listens` : null;
  const played =
    item.dj.finished + item.dj.skipped > 0
      ? `In sessions: ${fmtInt(item.dj.finished)} finished, ${fmtInt(item.dj.skipped)} skipped`
      : item.outcome.plays > 0
        ? `Played ${fmtInt(item.outcome.plays)} ${item.outcome.plays === 1 ? "time" : "times"} since, ${fmtInt(item.outcome.finished)} finished`
        : null;
  return (
    <li className="group -mx-2 flex gap-3 rounded-md px-2 py-3 transition-colors duration-150 hover:bg-fill">
      <span className="w-5 shrink-0 pt-2.5 text-right text-caption text-tertiary tabular">{item.position}</span>
      <Artwork src={item.albumArtUrl} name={item.name} box={40} />
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
      <span className="flex shrink-0 items-start md:opacity-0 md:transition-opacity md:duration-150 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:has-[[data-popup-open]]:opacity-100">
        <IconButton icon={PlayIcon} label={`Play ${item.name}`} size="sm" className="max-md:hidden" onClick={() => playback.play([item.uri])} />
        <MenuRoot>
          <MenuTrigger
            className={buttonClass({ variant: "ghost", size: "sm", className: "touch-target size-(--control-h-sm) px-0" })}
            aria-label={`More for ${item.name}`}
          >
            <Icon icon={DotsThreeIcon} size="md" />
          </MenuTrigger>
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
              <MenuItem icon={MusicNotesIcon} onClick={() => navigate(songPath(item.songKey))}>
                Go to song
              </MenuItem>
            )}
            <MenuItem icon={VinylRecordIcon} onClick={() => navigate(artistPath(item.artist))}>
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

function Conversation({ set, onRefined }: { set: SetDetail; onRefined: (result: SetResult) => void }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const gate = useClaudeGate({ needsSpotify: true });
  const path = `/api/sets/${set.id}/messages`;
  const run = useRun<SetResult>({ key: path, onDone: onRefined });
  const entries = timeline(set);
  const asking = set.version === 0;
  const send = async () => {
    const message = text.trim();
    setSent(message);
    setStopped(false);
    setText("");
    const result = await run.start(path, { message });
    if (!result) {
      setText(message);
      return;
    }
    onRefined(result);
  };
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-4">
        {entries.map((e, i) =>
          e.kind === "change" ? (
            <li key={`c${e.change.version}`} className="flex flex-col gap-0.5 text-caption text-secondary">
              <span className="font-medium text-primary">Version {e.change.version}</span>
              {changeLines(e.change).map((l) => (
                <span key={l} className="text-pretty">
                  {l}
                </span>
              ))}
            </li>
          ) : (
            <li key={i} className={e.role === "owner" ? "max-w-[85%] self-end rounded-lg bg-fill px-3 py-2 text-pretty" : "text-pretty text-secondary"}>
              {e.text}
            </li>
          ),
        )}
        {run.running && sent && <li className="max-w-[85%] self-end rounded-lg bg-fill px-3 py-2 text-pretty">{sent}</li>}
      </ol>
      {run.running ? (
        <RunProgress
          run={run}
          title="Changing the set"
          onCancel={() => {
            run.cancel();
            setStopped(true);
            if (sent) setText(sent);
          }}
        />
      ) : (
        <>
          {run.problem && (
            <RunNotice tone="danger" onRetry={gate.blocked || !text.trim() ? undefined : send}>
              {run.problem}
            </RunNotice>
          )}
          {stopped && <p className="text-secondary">Stopped.</p>}
          <Composer
            label={asking ? "Answer" : "Change the set"}
            placeholder={asking ? "Your answer" : "Less sad, more like track 3, a slower start"}
            value={text}
            onChange={setText}
            onSubmit={send}
            disabled={Boolean(gate.blocked)}
            notice={gate.blocked ?? gate.warning}
            footer={gate.spend}
          />
        </>
      )}
    </div>
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
        <Button size="sm" busy={stop.isPending} busyLabel="Stopping…" onClick={() => stop.mutate()}>
          Stop
        </Button>
      </div>
    </div>
  );
}

function SetActions({ set, playing }: { set: SetDetail; playing: boolean }) {
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
      await request(`/api/sets/${set.id}/playlist`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["sets"] });
      showToast(set.playlist ? "Playlist updated in Spotify." : "Saved to Spotify as a private playlist.");
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
    <div className="flex items-center gap-2 phone:grid phone:w-full phone:grid-cols-[minmax(0,1fr)_auto]">
      {!playing && (
        <Button
          variant="accent"
          icon={PlayIcon}
          disabled={empty || busy !== null}
          busy={busy === "play"}
          busyLabel="Starting…"
          onClick={play}
          className="phone:col-span-2"
        >
          Play as a session
        </Button>
      )}
      {!set.playlist || set.playlist.outdated ? (
        <Button disabled={empty || busy !== null} busy={busy === "save"} busyLabel="Saving…" onClick={save}>
          {set.playlist ? "Update playlist" : "Save to Spotify"}
        </Button>
      ) : (
        <a className={buttonClass()} href={set.playlist.url} target="_blank" rel="noreferrer">
          Open playlist
        </a>
      )}
      <MenuRoot>
        <MenuTrigger className={buttonClass({ variant: "ghost", className: "touch-target size-(--control-h) px-0" })} aria-label="More for this set">
          <Icon icon={DotsThreeIcon} size="md" />
        </MenuTrigger>
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
    <Page>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <RowSkeleton rows={8} rank />
    </Page>
  );
}

/** One set: its songs with the reasons, the session it plays as, and the conversation that changes it. */
export function SetPage({ id }: { id: number }) {
  const q = useSet(id);
  const dj = useDj();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<SetTrack | null>(null);

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
      <Page>
        <PageHeader title="Set" />
        <EmptyState
          size="page"
          icon={PlaylistIcon}
          title="This set no longer exists"
          action={
            <AppLink to="/sets" className={buttonClass()}>
              Back to sets
            </AppLink>
          }
        />
      </Page>
    ) : (
      <Page>
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

  return (
    <Page>
      <PageHeader title={set.title} description={set.description || undefined} actions={<SetActions set={set} playing={Boolean(playing)} />} />
      {(set.items.length > 0 || playing) && (
        <div className="-mt-6 flex flex-col gap-4 md:-mt-8">
          {set.items.length > 0 && <p className="text-secondary tabular">{summary(set)}</p>}
          {playing && <SessionLine session={playing} />}
        </div>
      )}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:gap-12">
        <Section title="Songs">
          {set.items.length === 0 ? (
            <EmptyState icon={PlaylistIcon} title="No songs yet" description="Answer the question to build the set." />
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
        <Section title="Conversation" className="lg:sticky lg:top-6 lg:self-start">
          <Conversation set={set} onRefined={(r) => replace(r.set)} />
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
        {set.playlist ? "The set gets a new version without it. Update the playlist to match." : "The set gets a new version without it."}
      </Confirm>
    </Page>
  );
}
