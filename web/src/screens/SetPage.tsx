import { Menu } from "@base-ui/react/menu";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { request } from "../api/client";
import { useSet } from "../api/queries";
import type { SetChange, SetDetail, SetResult, SetTrack } from "../api/types";
import { assistantProblem } from "../lib/assistant";
import { fmtAgo, fmtInt } from "../lib/format";
import { showToast } from "../lib/toast";
import { useRun } from "../lib/useRun";
import { openInSpotify } from "../player/playback";
import { AppLink, artistPath, songPath } from "../ui/AppLink";
import { Artwork, ArtTint } from "../ui/Artwork";
import { Composer } from "../ui/Composer";
import { Confirm } from "../ui/Confirm";
import { ArrowUp02Icon, Icon, MoreHorizontalIcon, PinIcon, PlayIcon } from "../ui/Icon";
import { Page, Section } from "../ui/Page";
import { RunProgress } from "../ui/RunProgress";
import { SongContext, SongMenu } from "../ui/SongMenu";
import { Empty, ErrorState, SkeletonRows } from "../ui/states";
import { SetCover } from "./Sets";
import { ApiError } from "../api/client";

const names = (tracks: { name: string }[]) => tracks.map((t) => t.name).join(", ");

function ChangeLines({ change }: { change: SetChange }) {
  const lines: string[] = [];
  if (change.source === "owner") {
    if (change.removed.length) lines.push(`You removed ${names(change.removed)}.`);
  } else {
    if (change.added.length) lines.push(`Added ${names(change.added)}.`);
    if (change.removed.length) lines.push(`Removed ${names(change.removed)}.`);
    if (change.moved.length) lines.push(`Moved ${change.moved.map((m) => `${m.name} (${m.from} to ${m.to})`).join(", ")}.`);
    if (lines.length === 0) lines.push("Same songs; reasons or title updated.");
  }
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-border-strong pl-3 text-body-sm text-secondary">
      <span className="font-medium text-primary">Version {change.version}</span>
      {lines.map((l) => (
        <span key={l} className="text-pretty">
          {l}
        </span>
      ))}
    </div>
  );
}

type Entry = { kind: "turn"; role: "owner" | "assistant"; text: string } | { kind: "change"; change: SetChange };

/** Orders the conversation and the version changes: each refinement's change follows the message that asked for it. */
function timeline(set: SetDetail): Entry[] {
  const pending = [...set.changes];
  const out: Entry[] = [];
  const flushOwnerBefore = (version: number) => {
    while (pending[0] && pending[0].source === "owner" && pending[0].version < version) out.push({ kind: "change", change: pending.shift()! });
  };
  set.conversation.forEach((turn, i) => {
    if (turn.role === "owner" && i > 0) {
      const match = pending.find((c) => c.source === "claude" && c.message === turn.text);
      if (match) flushOwnerBefore(match.version);
    }
    out.push({ kind: "turn", role: turn.role, text: turn.text });
    if (turn.role !== "owner" || i === 0) return;
    const idx = pending.findIndex((c) => c.source === "claude" && c.message === turn.text);
    if (idx >= 0) out.push({ kind: "change", change: pending.splice(idx, 1)[0]! });
  });
  for (const change of pending) out.push({ kind: "change", change });
  return out;
}

function TrackRow({
  item,
  added,
  movedFrom,
  onPin,
  onRemove,
}: {
  item: SetTrack;
  added: boolean;
  movedFrom: number | undefined;
  onPin: () => void;
  onRemove: () => void;
}) {
  const song = { uri: item.uri, name: item.name };
  const extra = [
    { label: item.pinned ? "Unpin" : "Pin, keep through changes", onSelect: onPin },
    { label: "Remove from set", onSelect: onRemove, danger: true },
  ];
  const origin =
    item.kind === "new"
      ? "New to you"
      : item.history
        ? `${fmtInt(item.history.listens)} listens, last ${fmtAgo(item.history.lastPlayed)}`
        : "From your library";
  const played =
    item.dj.finished + item.dj.skipped > 0
      ? `In sessions: ${item.dj.finished} finished, ${item.dj.skipped} skipped`
      : item.outcome.plays > 0
        ? `Played ${item.outcome.plays} ${item.outcome.plays === 1 ? "time" : "times"} since, ${item.outcome.finished} finished`
        : null;
  const change = added ? "Added in this version" : movedFrom ? `Moved from ${movedFrom}` : null;
  const title =
    item.kind === "library" ? (
      <AppLink to={songPath(item.songKey)} className="truncate font-medium hover-fine:underline">
        {item.name}
      </AppLink>
    ) : (
      <a href={openInSpotify(item.uri)} target="_blank" rel="noreferrer" className="truncate font-medium hover-fine:underline">
        {item.name}
      </a>
    );
  return (
    <SongContext song={song} extra={extra} className="group relative flex gap-3 py-3">
      {added && <span aria-hidden className="absolute top-3 bottom-3 -left-3 w-0.5 rounded-full bg-accent md:-left-4" />}
      <span className="w-6 shrink-0 pt-3 text-center text-body-sm font-semibold text-tertiary tabular">{item.position}</span>
      <Artwork src={item.albumArtUrl} name={item.name} className="size-12 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          {title}
          {item.pinned && (
            <span className="shrink-0 text-secondary" title="Pinned">
              <Icon icon={PinIcon} size={16} />
              <span className="sr-only">Pinned</span>
            </span>
          )}
        </div>
        <span className="truncate text-body-sm text-secondary">
          <AppLink to={artistPath(item.artist)} className="hover-fine:text-primary">
            {item.artist}
          </AppLink>{" "}
          · {origin}
        </span>
        <p className="mt-1 text-body-sm text-pretty">{item.reason}</p>
        {(played || change) && <p className="mt-0.5 text-body-sm text-tertiary">{[change, played].filter(Boolean).join(" · ")}</p>}
      </div>
      <SongMenu
        song={song}
        extra={extra}
        className="self-start md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[popup-open]:opacity-100"
      />
    </SongContext>
  );
}

function Conversation({ set, onRefined }: { set: SetDetail; onRefined: (result: SetResult) => void }) {
  const [text, setText] = useState("");
  const run = useRun<SetResult>();
  const entries = timeline(set);
  const send = async () => {
    const message = text.trim();
    const result = await run.start(`/api/sets/${set.id}/messages`, { message });
    if (!result) return;
    setText("");
    onRefined(result);
  };
  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-col gap-4">
        {entries.map((e, i) =>
          e.kind === "change" ? (
            <li key={`c${e.change.version}`}>
              <ChangeLines change={e.change} />
            </li>
          ) : (
            <li key={i} className={e.role === "owner" ? "self-end max-w-[85%] rounded-2xl bg-component px-3.5 py-2 text-pretty" : "text-pretty text-secondary"}>
              {e.text}
            </li>
          ),
        )}
        {run.running && text.trim() && <li className="max-w-[85%] self-end rounded-2xl bg-component px-3.5 py-2 text-pretty">{text.trim()}</li>}
      </ol>
      {run.running ? (
        <RunProgress run={run} title="Changing the set" onCancel={run.cancel} />
      ) : (
        <>
          {run.problem && (
            <p role="alert" className="text-danger">
              {run.problem}
            </p>
          )}
          <Composer
            label={set.version === 0 ? "Answer" : "Change the set"}
            placeholder={set.version === 0 ? "Your answer" : "Less sad, more like track 3, a slower start"}
            value={text}
            onChange={setText}
            onSubmit={send}
            action={
              <>
                <Icon icon={ArrowUp02Icon} size={16} />
                Send
              </>
            }
          />
        </>
      )}
    </div>
  );
}

function SetActions({ set }: { set: SetDetail }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState<"save" | "play" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const act = async (kind: "save" | "play" | "delete", run: () => Promise<void>) => {
    setBusy(kind);
    try {
      await run();
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
      navigate("/session");
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
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-accent" disabled={empty || busy !== null} onClick={play}>
        <Icon icon={PlayIcon} size={16} />
        {busy === "play" ? "Starting" : "Play as a session"}
      </button>
      {!set.playlist || set.playlist.outdated ? (
        <button type="button" className="btn btn-secondary" disabled={empty || busy !== null} onClick={save}>
          {busy === "save" ? "Saving" : set.playlist ? "Update playlist" : "Save to Spotify"}
        </button>
      ) : (
        <a className="btn btn-secondary" href={set.playlist.url} target="_blank" rel="noreferrer">
          Open playlist
        </a>
      )}
      <Menu.Root>
        <Menu.Trigger className="btn btn-icon btn-transparent" aria-label="More actions for this set">
          <Icon icon={MoreHorizontalIcon} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
            <Menu.Popup className="popup min-w-48 p-1 outline-none">
              {set.playlist && (
                <Menu.LinkItem className="menu-item" href={set.playlist.url} target="_blank" rel="noreferrer">
                  Open playlist in Spotify
                </Menu.LinkItem>
              )}
              <Menu.Item className="menu-item text-danger" onClick={() => setConfirmDelete(true)}>
                Delete set
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${set.title}”?`}
        action={busy === "delete" ? "Deleting" : "Delete"}
        danger
        busy={busy === "delete"}
        onConfirm={remove}
      >
        {set.playlist
          ? "The set and its conversation are deleted here. The playlist stays in your Spotify account."
          : "The set and its conversation are deleted."}
      </Confirm>
    </div>
  );
}

function Summary({ set }: { set: SetDetail }) {
  const fromLibrary = set.items.filter((i) => i.kind === "library").length;
  const fresh = set.items.length - fromLibrary;
  const finished = set.items.reduce((n, i) => n + i.dj.finished, 0);
  const skipped = set.items.reduce((n, i) => n + i.dj.skipped, 0);
  const parts: ReactNode[] = [
    `${fmtInt(set.items.length)} songs: ${fmtInt(fromLibrary)} from your library, ${fmtInt(fresh)} new to you`,
    set.djSessions > 0 && `played in ${set.djSessions} ${set.djSessions === 1 ? "session" : "sessions"}, ${finished} finished and ${skipped} skipped`,
    set.playlist && (set.playlist.outdated ? "changed since you saved it" : "saved to Spotify"),
  ];
  return <p className="text-body-sm text-secondary text-pretty">{parts.filter(Boolean).join(" · ")}.</p>;
}

export default function SetPage({ id }: { id: number }) {
  const q = useSet(id);
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
    return (
      <Page title="Set">
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <Empty title="This set no longer exists">
            <AppLink to="/sets" className="font-medium text-primary underline underline-offset-2">
              Back to your sets
            </AppLink>
          </Empty>
        ) : (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        )}
      </Page>
    );
  if (!q.data)
    return (
      <Page title="Set">
        <SkeletonRows rows={10} />
      </Page>
    );

  const set = q.data;
  const latest = set.changes.at(-1);
  const current = latest && latest.version === set.version && latest.source === "claude" ? latest : null;
  const added = new Set(current?.added.map((t) => t.songKey));
  const moved = new Map(current?.moved.map((m) => [m.songKey, m.from]));
  const covers = set.items.map((i) => i.albumArtUrl).filter((u): u is string => Boolean(u));

  return (
    <Page
      title={set.title}
      hero={() => (
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:gap-8">
          <ArtTint src={covers[0]} />
          <SetCover covers={covers} title={set.title} className="w-40 shadow-large md:w-52" />
          <div className="flex min-w-0 flex-col gap-2 md:pb-1">
            <h1 className="text-heading-4 font-semibold text-balance md:text-heading-2">{set.title}</h1>
            {set.description && <p className="max-w-2xl text-body-lg text-secondary text-pretty">{set.description}</p>}
            {set.items.length > 0 && <Summary set={set} />}
            <div className="mt-2">
              <SetActions set={set} />
            </div>
          </div>
        </div>
      )}
    >
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:gap-14">
        <Section title="Tracks">
          {set.items.length === 0 ? (
            <Empty title="No songs yet">Answer the question to build the set.</Empty>
          ) : (
            <ol className="flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-border-default">
              {set.items.map((item) => (
                <TrackRow
                  key={item.songKey}
                  item={item}
                  added={added.has(item.songKey)}
                  movedFrom={moved.get(item.songKey)}
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
        {set.playlist ? "The set gets a new version; update the playlist to match." : "The set gets a new version without it."}
      </Confirm>
    </Page>
  );
}
