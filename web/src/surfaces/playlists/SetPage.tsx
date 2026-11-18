import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { ApiError, request } from "../../api/client";
import { useDj, useLiving, useSet, useTimezone } from "../../api/queries";
import type { DjSession, SavedPlaylist, SetChange, SetConstraints, SetDetail, SetTrack } from "../../api/types";
import { useOpenQueue } from "../../app/Shell";
import { artistPath, songPath } from "../../app/paths";
import { useChat } from "../../chat/state";
import { useAi } from "../../lib/ai";
import { assistantProblem } from "../../lib/assistant";
import { fmtAgo, fmtDate, fmtInt } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { openInSpotify, usePlayback } from "../../player/playback";
import { Artwork } from "../../ui/Artwork";
import { Button, IconButton } from "../../ui/Button";
import { Confirm } from "../../ui/Dialog";
import { EntityHeader, EntityHeaderSkeleton } from "../../ui/EntityHeader";
import { Input } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import {
  ArrowUpRightIcon,
  ChatCircleTextIcon,
  MicrophoneStageIcon,
  MusicNoteIcon,
  PlayIcon,
  PlaylistIcon,
  ProhibitIcon,
  PushPinIcon,
  QueueIcon,
  TrashIcon,
  WaveformIcon,
  XIcon,
} from "../../ui/icons";
import { MenuItem, MenuLinkItem, MenuPopup, MenuRoot, MenuSeparator, MoreTrigger } from "../../ui/Menu";
import { Page, PageHeader, SIDE_COLUMNS, Section, useDocumentTitle } from "../../ui/Page";
import { RowSkeleton } from "../../ui/Rows";
import { SettingRow, SettingRows } from "../../ui/SettingRow";
import { EmptyState, ErrorState } from "../../ui/States";
import { PlaylistMissing } from "./LivingPage";
import { gateNotice, songs } from "./shared";

function TrackRow({ item, added, onPin, onRemove, onLeaveOut }: { item: SetTrack; added: boolean; onPin: () => void; onRemove: () => void; onLeaveOut: (() => void) | null }) {
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
            {onLeaveOut && (
              <MenuItem icon={ProhibitIcon} onClick={onLeaveOut}>
                Leave out this song
              </MenuItem>
            )}
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

function SetActions({ set, playing, canSave }: { set: SetDetail; playing: boolean; canSave: boolean }) {
  const queryClient = useQueryClient();
  const openQueue = useOpenQueue();
  const playback = usePlayback();
  const chat = useChat();
  const ai = useAi();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState<"save" | "session" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const act = async (kind: "save" | "session" | "delete", work: () => Promise<void>) => {
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
  const session = () =>
    act("session", async () => {
      await request(`/api/sets/${set.id}/play`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["dj"] });
      openQueue();
    });
  const remove = () =>
    act("delete", async () => {
      await request(`/api/sets/${set.id}`, { method: "DELETE" });
      queryClient.removeQueries({ queryKey: ["sets", set.id] });
      await queryClient.invalidateQueries({ queryKey: ["sets"] });
      navigate("/playlists?show=sets");
    });
  const play = () => (set.playlist && !set.playlist.outdated ? playback.playContext(`spotify:playlist:${set.playlist.id}`) : playback.play(set.items.map((i) => i.uri)));
  const empty = set.items.length === 0;
  const thread = { kind: "set", id: set.id } as const;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="accent" icon={PlayIcon} disabled={empty} onClick={() => void play()}>
        Play
      </Button>
      {(!set.playlist || set.playlist.outdated) && (
        <Button disabled={empty || !canSave || busy !== null} busy={busy === "save"} busyLabel="Saving" onClick={save} className="phone:hidden">
          {set.playlist ? "Update playlist" : "Save to Spotify"}
        </Button>
      )}
      {ai.configured && (
        <Button icon={ChatCircleTextIcon} onClick={() => chat.show({ thread })}>
          {chat.runningFor(thread) ? "Changing…" : set.version === 0 ? "Answer" : "Change"}
        </Button>
      )}
      <MenuRoot>
        <MoreTrigger label="More for this set" size="md" />
        <MenuPopup>
          {(!set.playlist || set.playlist.outdated) && (
            <MenuItem icon={ArrowUpRightIcon} disabled={empty || !canSave || busy !== null} onClick={save} className="md:hidden">
              {set.playlist ? "Update playlist" : "Save to Spotify"}
            </MenuItem>
          )}
          {!playing && (
            <MenuItem icon={WaveformIcon} disabled={empty || busy !== null} onClick={session}>
              Play as a session
            </MenuItem>
          )}
          {set.playlist && (
            <MenuLinkItem icon={ArrowUpRightIcon} href={set.playlist.url} target="_blank" rel="noreferrer">
              Open in Spotify
            </MenuLinkItem>
          )}
          <MenuSeparator />
          <MenuItem icon={TrashIcon} danger onClick={() => setConfirmDelete(true)}>
            Delete set
          </MenuItem>
        </MenuPopup>
      </MenuRoot>
      <Confirm open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete “${set.title}”?`} action="Delete" danger busy={busy === "delete"} onConfirm={remove}>
        {set.playlist ? "The set and its conversation are deleted. The playlist stays in your Spotify account." : "The set and its conversation are deleted."}
      </Confirm>
    </div>
  );
}

function freshness(set: SetDetail): { text: string; problem: boolean } {
  if (set.version === 0) return { text: "Waiting for your answer", problem: false };
  const fromLibrary = set.items.filter((i) => i.kind === "library").length;
  const mix = `${songs(set.items.length)}: ${fmtInt(fromLibrary)} you know, ${fmtInt(set.items.length - fromLibrary)} new to you`;
  if (set.playlist?.outdated) return { text: `${mix} · Spotify did not take the last change`, problem: true };
  return { text: [mix, `updated ${fmtAgo(set.updatedAt)}`, set.playlist && "in your Spotify"].filter(Boolean).join(" · "), problem: false };
}

type Draft = { maxPerArtist: string; maxPerAlbum: string; newSongs: string; artists: string[]; songs: { songKey: string; label: string }[] };

const draftOf = (c: SetConstraints): Draft => ({
  maxPerArtist: c.maxPerArtist === null ? "" : String(c.maxPerArtist),
  maxPerAlbum: c.maxPerAlbum === null ? "" : String(c.maxPerAlbum),
  newSongs: c.newSongs === null ? "" : String(c.newSongs),
  artists: c.exclude.artists,
  songs: c.exclude.songs,
});

function readLimit(raw: string, min: number): number | null | "bad" {
  if (!raw.trim()) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= 80 ? n : "bad";
}

/** The set's hard rules as controls. Saving changes no song: the next change to the set has to meet them. */
function Constraints({ set }: { set: SetDetail }) {
  const queryClient = useQueryClient();
  const ai = useAi();
  const [draft, setDraft] = useState(() => draftOf(set.constraints));
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState(false);
  const base = draftOf(set.constraints);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const perArtist = readLimit(draft.maxPerArtist, 1);
  const perAlbum = readLimit(draft.maxPerAlbum, 1);
  const fresh = readLimit(draft.newSongs, 0);
  const bad = perArtist === "bad" || perAlbum === "bad" || fresh === "bad";
  const change = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const addArtist = () => {
    const name = artist.trim();
    if (name && !draft.artists.some((a) => a.toLowerCase() === name.toLowerCase())) change({ artists: [...draft.artists, name] });
    setArtist("");
  };
  const save = async () => {
    if (bad) return;
    setBusy(true);
    try {
      const next = await request<SetDetail>(`/api/sets/${set.id}/constraints`, {
        method: "PATCH",
        json: { maxPerArtist: perArtist, maxPerAlbum: perAlbum, newSongs: fresh, exclude: { artists: draft.artists, songs: draft.songs } },
      });
      queryClient.setQueryData(["sets", set.id], next);
      setDraft(draftOf(next.constraints));
      showToast(ai.configured ? "Saved. The next change to the set follows them." : "Saved.");
    } catch (error) {
      showToast(error instanceof ApiError && error.status === 400 ? "One of the limits is out of range." : assistantProblem(error), "problem");
    } finally {
      setBusy(false);
    }
  };
  const limit = (key: "maxPerArtist" | "maxPerAlbum" | "newSongs", label: string, placeholder: string, value: number | null | "bad") => (
    <SettingRow label={label} error={value === "bad" ? `A whole number from ${key === "newSongs" ? 0 : 1} to 80` : null}>
      {(p) => (
        <Input
          {...p}
          type="number"
          inputMode="numeric"
          min={key === "newSongs" ? 0 : 1}
          max={80}
          placeholder={placeholder}
          value={draft[key]}
          onChange={(e) => change({ [key]: e.target.value })}
          className="w-32"
        />
      )}
    </SettingRow>
  );
  return (
    <div className="flex flex-col gap-2">
      <SettingRows>
        {limit("maxPerArtist", "Songs per artist", "No limit", perArtist)}
        {limit("maxPerAlbum", "Songs per album", "No limit", perAlbum)}
        {limit("newSongs", "Songs new to you", "Any number", fresh)}
        <SettingRow label="Leave out artists" wide>
          {(p) => (
            <div className="flex flex-col gap-2">
              {draft.artists.length > 0 && (
                <ul className="flex flex-col">
                  {draft.artists.map((a) => (
                    <li key={a} className="flex min-h-(--control-h) items-center justify-between gap-3">
                      <span className="truncate">{a}</span>
                      <IconButton icon={XIcon} size="sm" label={`Stop leaving out ${a}`} onClick={() => change({ artists: draft.artists.filter((x) => x !== a) })} />
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="flex max-w-sm gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addArtist();
                }}
              >
                <Input {...p} value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist name" autoCapitalize="none" autoCorrect="off" enterKeyHint="done" className="flex-1" />
                <Button type="submit" disabled={!artist.trim()}>
                  Add
                </Button>
              </form>
            </div>
          )}
        </SettingRow>
        {draft.songs.length > 0 && (
          <SettingRow label="Leave out songs" wide>
            {() => (
              <ul className="flex flex-col">
                {draft.songs.map((s) => (
                  <li key={s.songKey} className="flex min-h-(--control-h) items-center justify-between gap-3">
                    <span className="truncate">{s.label}</span>
                    <IconButton icon={XIcon} size="sm" label={`Stop leaving out ${s.label}`} onClick={() => change({ songs: draft.songs.filter((x) => x.songKey !== s.songKey) })} />
                  </li>
                ))}
              </ul>
            )}
          </SettingRow>
        )}
      </SettingRows>
      {dirty && (
        <div className="flex gap-2">
          <Button variant="primary" busy={busy} busyLabel="Saving" disabled={bad} onClick={() => void save()}>
            Save limits
          </Button>
          <Button variant="ghost" onClick={() => setDraft(base)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function HowItFills({ set }: { set: SetDetail }) {
  return (
    <Section title="How it fills">
      <div className="flex max-w-(--measure) flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="text-secondary">Made from a prompt</p>
          <blockquote className="text-body text-pretty text-primary">“{set.request}”</blockquote>
        </div>
        <Constraints key={JSON.stringify(set.constraints)} set={set} />
      </div>
    </Section>
  );
}

function changeLine(c: SetChange): string {
  const parts = [c.added.length > 0 && `added ${fmtInt(c.added.length)}`, c.removed.length > 0 && `removed ${fmtInt(c.removed.length)}`, c.moved.length > 0 && `moved ${fmtInt(c.moved.length)}`].filter(Boolean);
  const text = parts.length ? parts.join(", ") : "same songs";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Every version after the first, newest first: what changed and what was asked for. */
function SetChanges({ set }: { set: SetDetail }) {
  const timezone = useTimezone();
  const changes = [...set.changes].reverse();
  return (
    <Section title="Changes">
      {changes.length === 0 ? (
        <p className="text-secondary">No changes yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {changes.map((c) => (
            <li key={c.version} className="flex flex-col gap-0.5">
              <span className="text-primary">{fmtDate(c.at, timezone)}</span>
              <span className="text-caption text-secondary tabular">
                {changeLine(c)}
                {c.source === "owner" ? " · by hand" : ""}
              </span>
              {c.message && <span className="line-clamp-2 text-caption text-pretty text-secondary">“{c.message}”</span>}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/** A set, on the same template as every playlist: header, its prompt and limits, its songs with reasons, its changes. */
export function SetPage({ id }: { id: number }) {
  const q = useSet(id);
  const dj = useDj();
  const gate = useLiving().data?.spotify;
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<SetTrack | null>(null);
  useDocumentTitle(q.data?.title ?? "Set");

  const edit = async (item: SetTrack, init: RequestInit & { json?: unknown }) => {
    try {
      queryClient.setQueryData(["sets", id], await request<SetDetail>(`/api/sets/${id}/items/${item.position}`, init));
      void queryClient.invalidateQueries({ queryKey: ["sets"], exact: true });
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    }
  };

  const leaveOut = async (set: SetDetail, item: SetTrack) => {
    const songs = [...set.constraints.exclude.songs, { songKey: item.songKey, label: `${item.name} - ${item.artist}` }];
    try {
      const next = await request<SetDetail>(`/api/sets/${id}/constraints`, { method: "PATCH", json: { exclude: { artists: set.constraints.exclude.artists, songs } } });
      queryClient.setQueryData(["sets", id], next);
      showToast(`${item.name} is left out of the next change.`);
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    }
  };

  if (q.isError)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <PlaylistMissing />
    ) : (
      <Page crumb={null}>
        <PageHeader title="Set" />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Page>
    );
  if (!q.data)
    return (
      <Page crumb={undefined}>
        <EntityHeaderSkeleton />
        <RowSkeleton rows={8} rank />
      </Page>
    );

  const set = q.data;
  const latest = set.changes.at(-1);
  const current = latest && latest.version === set.version && latest.source === "claude" ? latest : null;
  const added = new Set(current?.added.map((t) => t.songKey));
  const session = dj.data?.session;
  const playing = session?.status === "active" && session.set?.id === set.id ? session : null;
  const fresh = freshness(set);

  return (
    <Page crumb={set.title}>
      <EntityHeader
        title={set.title}
        art={set.coverUrl}
        kind="playlist"
        credits={set.description || undefined}
        detail={<span className={fresh.problem ? "text-danger" : undefined}>{fresh.text}</span>}
        actions={<SetActions set={set} playing={Boolean(playing)} canSave={!gate || (gate.connected && gate.canWrite)} />}
      />
      {gate && gateNotice(gate)}
      {playing && <SessionLine session={playing} />}
      <div className={SIDE_COLUMNS}>
        <div className="flex min-w-0 flex-col gap-10 md:gap-12">
          <HowItFills set={set} />
          <Section title="Songs" description={set.items.length > 0 ? songs(set.items.length) : undefined}>
            {set.items.length === 0 ? (
              <EmptyState icon={PlaylistIcon} title="No songs yet" description="Answer the question in the chat to build the set." />
            ) : (
              <ol className="flex flex-col">
                {set.items.map((item) => (
                  <TrackRow
                    key={item.songKey}
                    item={item}
                    added={added.has(item.songKey)}
                    onPin={() => edit(item, { method: "PATCH", json: { pinned: !item.pinned } })}
                    onRemove={() => setRemoving(item)}
                    onLeaveOut={set.constraints.exclude.songs.some((s) => s.songKey === item.songKey) ? null : () => void leaveOut(set, item)}
                  />
                ))}
              </ol>
            )}
          </Section>
        </div>
        <SetChanges set={set} />
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
