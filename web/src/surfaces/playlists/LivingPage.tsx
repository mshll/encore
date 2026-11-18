import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { ApiError, request } from "../../api/client";
import { useLiving, useLivingPlaylist, useLivingRefresh, useTimezone } from "../../api/queries";
import type { LivingChange, LivingDetail, LivingId, RuleDeleted } from "../../api/types";
import { fmtDate, fmtDayShort, fmtInt } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { AppLink } from "../../ui/AppLink";
import { Button, buttonClass } from "../../ui/Button";
import { Confirm, Dialog, DialogClose } from "../../ui/Dialog";
import { EntityHeader, EntityHeaderSkeleton } from "../../ui/EntityHeader";
import { ArrowClockwiseIcon, ArrowUpRightIcon, PauseCircleIcon, PencilSimpleIcon, PlayIcon, PlaylistIcon, TrashIcon } from "../../ui/icons";
import { MenuItem, MenuLinkItem, MenuPopup, MenuRoot, MenuSeparator, MoreTrigger } from "../../ui/Menu";
import { Notice } from "../../ui/Notice";
import { Page, PageHeader, SIDE_COLUMNS, Section, dimWhile, useDocumentTitle } from "../../ui/Page";
import { RowList, RowSkeleton } from "../../ui/Rows";
import { EmptyState, ErrorState } from "../../ui/States";
import { Switch } from "../../ui/Switch";
import { WeeklyPicks } from "../Picks";
import { ReleasesSection } from "../Releases";
import { describeRule } from "./rules";
import { freshLine, gateNotice, isKind, NOTHING_YET, playable, SongRow, songs, useLivingAction, usePlayPlaylist, type Gate } from "./shared";

function changeLine(change: LivingChange, first: boolean): string {
  if (change.trigger === "year-end") return `Closed the year with ${songs(change.count)}`;
  if (first && change.removed.length === 0) return `Started with ${songs(change.count)}`;
  const parts = [change.added.length > 0 && `added ${fmtInt(change.added.length)}`, change.removed.length > 0 && `removed ${fmtInt(change.removed.length)}`].filter(Boolean);
  const text = parts.length ? parts.join(", ") : "same songs";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ChangeDialog({ kind, change, onClose }: { kind: LivingId; change: LivingChange | null; onClose: () => void }) {
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

/** Every refresh that changed the playlist, newest first; each opens what it held then. */
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
                <span className="text-caption text-secondary tabular">
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

function StateNotice({ playlist, onRetry }: { playlist: LivingDetail; onRetry: () => void }) {
  const timezone = useTimezone();
  if (playlist.removedAt) return <Notice tone="warning">Deleted in Spotify on {fmtDate(playlist.removedAt, timezone)}. Keep it in Spotify again to make a new one.</Notice>;
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

/** When it next refreshes, or that it does not while frozen. */
function refreshLine(p: LivingDetail): string | null {
  if (!p.enabled) return null;
  if (p.frozen) return "Frozen: it keeps these songs until you refresh it or unfreeze it.";
  return p.nextRefresh ? `Next refresh ${fmtDayShort(p.nextRefresh)}.` : null;
}

/** The rule in plain words, for every playlist: a built-in's fixed rule and an owner's own. */
function HowItFills({ playlist }: { playlist: LivingDetail }) {
  const next = refreshLine(playlist);
  return (
    <Section
      title="How it fills"
      actions={
        !playlist.builtin && (
          <AppLink to={`/playlists/${playlist.kind}/edit`} className={buttonClass({ size: "sm", variant: "ghost" })}>
            Edit rule
          </AppLink>
        )
      }
    >
      <ul className="flex max-w-(--measure) flex-col gap-1 text-body text-pretty">
        {describeRule(playlist.rule).map((line) => (
          <li key={line}>{line}.</li>
        ))}
        {next && <li className="text-secondary">{next}</li>}
      </ul>
    </Section>
  );
}

type Action = ReturnType<typeof useLivingAction>;

function LivingActions({ playlist, gate, action, onDelete }: { playlist: LivingDetail; gate: Gate | undefined; action: Action; onDelete: () => void }) {
  const blocked = gate ? !gate.connected || !gate.canWrite : false;
  const switchId = `living-${playlist.kind}`;
  const play = usePlayPlaylist();
  const [, navigate] = useLocation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {playable(playlist) && (
        <Button variant="accent" icon={PlayIcon} onClick={() => void play(playlist)}>
          Play
        </Button>
      )}
      <span className="flex min-h-(--control-h) items-center gap-2 px-2">
        <Switch id={switchId} checked={playlist.enabled} onChange={action.toggle} label="Keep in Spotify" disabled={action.busy !== null || (blocked && !playlist.enabled)} />
        <label htmlFor={switchId} className="text-primary">
          Keep in Spotify
        </label>
      </span>
      {playlist.enabled && (
        <Button busy={action.busy === "refresh"} busyLabel="Refreshing" disabled={action.busy !== null || blocked} onClick={action.refresh} className="phone:hidden">
          Refresh now
        </Button>
      )}
      <MenuRoot>
        <MoreTrigger label={`More for ${playlist.name}`} size="md" />
        <MenuPopup>
          {playlist.enabled && (
            <MenuItem icon={ArrowClockwiseIcon} disabled={action.busy !== null || blocked} onClick={action.refresh} className="md:hidden">
              Refresh now
            </MenuItem>
          )}
          {!playlist.builtin && (
            <MenuItem icon={PencilSimpleIcon} onClick={() => navigate(`/playlists/${playlist.kind}/edit`)}>
              Edit rule
            </MenuItem>
          )}
          <MenuItem icon={PauseCircleIcon} disabled={action.busy !== null} onClick={() => action.freeze(!playlist.frozen)}>
            {playlist.frozen ? "Unfreeze" : "Freeze"}
          </MenuItem>
          {playlist.playlist && (
            <MenuLinkItem icon={ArrowUpRightIcon} href={playlist.playlist.url} target="_blank" rel="noreferrer">
              Open in Spotify
            </MenuLinkItem>
          )}
          {!playlist.builtin && (
            <>
              <MenuSeparator />
              <MenuItem icon={TrashIcon} danger onClick={onDelete}>
                Delete playlist
              </MenuItem>
            </>
          )}
        </MenuPopup>
      </MenuRoot>
    </div>
  );
}

function useDeleteRule(playlist: LivingDetail | undefined) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!playlist) return;
    setBusy(true);
    try {
      const result = await request<RuleDeleted>(`/api/living/${playlist.kind}`, { method: "DELETE" });
      queryClient.removeQueries({ queryKey: ["living", playlist.kind] });
      await queryClient.invalidateQueries({ queryKey: ["living"], exact: true });
      navigate("/playlists?show=rules");
      showToast(result.spotifyPlaylist ? `${playlist.name} is deleted. Its Spotify playlist stays as it is.` : `${playlist.name} is deleted.`);
    } catch {
      showToast("Could not delete it. Try again.", "problem");
    } finally {
      setBusy(false);
    }
  };
  return { busy, remove };
}

function DetailSkeleton() {
  return (
    <Page crumb={undefined}>
      <EntityHeaderSkeleton />
      <RowSkeleton rows={8} rank />
    </Page>
  );
}

export function PlaylistMissing() {
  return (
    <Page crumb={null}>
      <PageHeader title="Playlist" />
      <EmptyState
        size="page"
        icon={PlaylistIcon}
        title="This playlist does not exist"
        action={
          <AppLink to="/playlists" className={buttonClass()}>
            Open Playlists
          </AppLink>
        }
      />
    </Page>
  );
}

/** One living playlist, built-in or the owner's rule: header, how it fills, its songs, its changes. */
export function LivingPage({ id }: { id: LivingId }) {
  const q = useLivingPlaylist(id);
  const list = useLiving();
  const action = useLivingAction(id, q.data?.name ?? "");
  const del = useDeleteRule(q.data);
  const [confirm, setConfirm] = useState(false);
  useDocumentTitle(q.data?.name ?? "Playlist");

  if (q.isError)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <PlaylistMissing />
    ) : (
      <Page crumb={null}>
        <PageHeader title="Playlist" />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Page>
    );
  if (!q.data) return <DetailSkeleton />;

  const p = q.data;
  const shown = p.items.length ? p.items : p.preview;
  const gate = list.data?.spotify;
  const fresh = freshLine(p, null, true);
  const kind = isKind(p.kind) ? p.kind : null;
  return (
    <Page crumb={p.name}>
      <EntityHeader
        title={p.name}
        art={p.coverUrl}
        kind="playlist"
        credits={p.about || undefined}
        detail={<span className={fresh.problem ? "text-danger" : undefined}>{fresh.text}</span>}
        actions={<LivingActions playlist={p} gate={gate} action={action} onDelete={() => setConfirm(true)} />}
      />
      {gate && gateNotice(gate)}
      <StateNotice playlist={p} onRetry={action.refresh} />
      <div className={SIDE_COLUMNS}>
        <div className="flex min-w-0 flex-col gap-10 md:gap-12">
          <HowItFills playlist={p} />
          {kind === "picks" ? (
            <WeeklyPicks />
          ) : (
            <>
              {kind === "new-releases" && <ReleasesSection />}
              <Section
                title={p.items.length || p.playlist ? "Songs" : p.enabled ? "It will start with" : "It would start with"}
                description={shown.length ? songs(p.items.length ? p.count : shown.length) : undefined}
              >
                {shown.length === 0 ? (
                  <EmptyState icon={PlaylistIcon} title="Nothing to put in it yet" description={kind ? NOTHING_YET[kind] : "No song meets the rule yet."} />
                ) : (
                  <RowList label={p.name} className={dimWhile(q.isFetching)}>
                    {shown.map((s, i) => (
                      <SongRow key={s.uri} song={s} rank={i + 1} kind={p.kind} />
                    ))}
                  </RowList>
                )}
              </Section>
            </>
          )}
        </div>
        <Changes playlist={p} />
      </div>
      <Confirm open={confirm} onOpenChange={setConfirm} title={`Delete “${p.name}”?`} action="Delete" danger busy={del.busy} onConfirm={() => void del.remove()}>
        {p.playlist ? "encore stops refreshing it and forgets its rule. The playlist stays in your Spotify account as it is." : "Its rule and its changes are deleted."}
      </Confirm>
    </Page>
  );
}

