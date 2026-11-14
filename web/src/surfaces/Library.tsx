import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, request } from "../api/client";
import { useBlocks, useCleanup, useCleanupBatches, useTimezone } from "../api/queries";
import type { Block, CleanupBatch, CleanupKind, CleanupProposal } from "../api/types";
import { fmtAgo, fmtDate, fmtInt } from "../lib/format";
import { showToast } from "../lib/toast";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { cx } from "../ui/cx";
import { Confirm } from "../ui/Dialog";
import { BroomIcon } from "../ui/icons";
import { Page, PageHeader, Section } from "../ui/Page";
import { RowSkeleton } from "../ui/Rows";
import { TabList, TabPanel, TabsRoot } from "../ui/Segmented";
import { describeError, EmptyState, ErrorState } from "../ui/States";

const KINDS: { value: CleanupKind; label: string; rule: string; empty: string }[] = [
  {
    value: "saved_dislike",
    label: "Rarely finished",
    rule: "Saved songs you have played 8 times or more and let play through at most 1 time in 5.",
    empty: "Every saved song you play often, you also let play through.",
  },
  { value: "saved_never_played", label: "Never played", rule: "Saved more than 30 days ago and never played.", empty: "Every song saved over 30 days ago has been played." },
  {
    value: "playlist_skipped",
    label: "Rarely finished in playlists",
    rule: "Songs in your own playlists, played 8 times or more and almost never played through.",
    empty: "No song in your playlists stands out this way.",
  },
  { value: "playlist_duplicate", label: "Duplicates", rule: "The same song more than once in one playlist. Removing keeps the first copy.", empty: "No playlist has the same song twice." },
];

const songs = (n: number) => `${fmtInt(n)} ${n === 1 ? "song" : "songs"}`;
const plays = (n: number) => `${fmtInt(n)} ${n === 1 ? "play" : "plays"}`;

function consequence(kind: CleanupKind, n: number) {
  if (kind === "playlist_duplicate") return `Removes the extra copies of ${songs(n)} from their playlists. The first copy stays.`;
  if (kind === "playlist_skipped") return `Removes ${songs(n)} from their playlists, every copy.`;
  return `Removes ${songs(n)} from your saved songs in Spotify.`;
}

/** Why a song is proposed, in plays and listens. Skips alone are never the reason given. */
function evidence(p: CleanupProposal, timezone: string): string {
  const e = p.evidence;
  const parts = [
    p.kind === "playlist_duplicate" && e.duplicates ? `${fmtInt(e.duplicates.length + 1)} copies` : null,
    e.plays > 0 ? `${plays(e.plays)}, ${fmtInt(e.listens)} played through` : "Never played",
    e.lastPlayed && `last played ${fmtDate(e.lastPlayed, timezone)}`,
    e.savedAt && `saved ${fmtDate(e.savedAt, timezone)}`,
    e.playlistName && `in ${e.playlistName}`,
  ];
  return parts.filter(Boolean).join(", ");
}

function ProposalRow({ p, checked, onToggle, timezone }: { p: CleanupProposal; checked: boolean; onToggle: () => void; timezone: string }) {
  const id = `proposal-${p.id}`;
  return (
    <li className={cx("-mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-2 transition-colors duration-150", checked ? "bg-accent-subtle" : "hover:bg-fill")}>
      <Checkbox id={id} checked={checked} onChange={onToggle} label={`Select ${p.evidence.name}`} />
      <Artwork src={p.evidence.albumArtUrl} name={p.evidence.name} box={40} />
      <div className="flex min-w-0 flex-1 flex-col">
        <label htmlFor={id} className="truncate text-primary" title={p.evidence.name}>
          {p.evidence.name}
        </label>
        {p.evidence.artist && <span className="truncate text-caption text-secondary">{p.evidence.artist}</span>}
        <span className="truncate text-caption text-secondary">{evidence(p, timezone)}</span>
      </div>
    </li>
  );
}

function Proposals({ kind }: { kind: CleanupKind }) {
  const queryClient = useQueryClient();
  const timezone = useTimezone();
  const q = useCleanup(kind, "open");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<"apply" | "dismiss" | null>(null);
  const [busy, setBusy] = useState(false);
  const items = q.data && !q.isPlaceholderData ? q.data.items : [];
  const ids = items.filter((p) => selected.has(p.id)).map((p) => p.id);
  const all = items.length > 0 && ids.length === items.length;
  const meta = KINDS.find((k) => k.value === kind)!;

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const finish = async () => {
    setBusy(false);
    setConfirm(null);
    setSelected(new Set());
    await queryClient.invalidateQueries({ queryKey: ["cleanup"] });
  };

  const apply = async () => {
    setBusy(true);
    try {
      const r = await request<{ batchId: number; applied: number }>("/api/cleanup/apply", { json: { ids } });
      showToast(`Removed ${songs(r.applied)}`, "info", { label: "Undo", onClick: () => void undoBatch(queryClient, r.batchId) });
    } catch (error) {
      if (error instanceof ApiError && error.code === "cleanup_partial") showToast("Spotify stopped part way. What was removed is under Applied, where you can undo it.", "problem");
      else showToast(describeError(error), "problem");
    }
    await finish();
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      const r = await request<{ dismissed: number }>("/api/cleanup/dismiss", { json: { ids } });
      showToast(`Dismissed ${songs(r.dismissed)}`);
    } catch (error) {
      showToast(describeError(error), "problem");
    }
    await finish();
  };

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data || q.isPlaceholderData) return <RowSkeleton rows={8} />;
  if (items.length === 0) return <EmptyState title="Nothing to propose" description={meta.empty} />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-secondary text-pretty">{meta.rule}</p>
      <div className="sticky top-0 z-10 -mx-2 flex min-h-(--control-h-lg) flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-page px-2 py-2">
        <label className="flex items-center gap-3 font-medium text-primary">
          <Checkbox label="Select all" checked={all} indeterminate={ids.length > 0 && !all} onChange={() => setSelected(all ? new Set() : new Set(items.map((p) => p.id)))} />
          {ids.length > 0 ? `${fmtInt(ids.length)} selected` : `Select all ${fmtInt(items.length)}`}
        </label>
        <div className="flex gap-2">
          <Button disabled={ids.length === 0 || busy} onClick={() => setConfirm("dismiss")}>
            Dismiss
          </Button>
          <Button variant="danger" disabled={ids.length === 0 || busy} onClick={() => setConfirm("apply")}>
            Remove
          </Button>
        </div>
      </div>
      <ul aria-label={meta.label} className="flex flex-col">
        {items.map((p) => (
          <ProposalRow key={p.id} p={p} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} timezone={timezone} />
        ))}
      </ul>
      <Confirm
        open={confirm === "apply"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Remove ${songs(ids.length)}?`}
        action="Remove"
        danger
        busy={busy}
        onConfirm={() => void apply()}
      >
        {consequence(kind, ids.length)} You can undo it under Applied.
      </Confirm>
      <Confirm open={confirm === "dismiss"} onOpenChange={(open) => !open && setConfirm(null)} title={`Dismiss ${songs(ids.length)}?`} action="Dismiss" busy={busy} onConfirm={() => void dismiss()}>
        They stop being proposed. Nothing changes in Spotify.
      </Confirm>
    </div>
  );
}

async function undoBatch(queryClient: ReturnType<typeof useQueryClient>, id: number) {
  try {
    const r = await request<{ restored: number }>(`/api/cleanup/batches/${id}/undo`, { method: "POST" });
    showToast(`Restored ${songs(r.restored)}`);
  } catch (error) {
    showToast(describeError(error), "problem");
  }
  await queryClient.invalidateQueries({ queryKey: ["cleanup"] });
}

function Batches({ items }: { items: CleanupBatch[] }) {
  const queryClient = useQueryClient();
  const [undoing, setUndoing] = useState<CleanupBatch | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Applied">
      <ul className="flex flex-col">
        {items.map((b) => (
          <li key={b.id} className="flex min-h-(--row-h) items-center justify-between gap-3 py-1">
            <span className="flex min-w-0 flex-col">
              <span className="text-primary">
                {fmtInt(b.actions)} {b.actions === 1 ? "removal" : "removals"}
              </span>
              <span className="truncate text-caption text-secondary">{b.undoneAt ? `Undone ${fmtAgo(b.undoneAt)}` : `Applied ${fmtAgo(b.appliedAt)}`}</span>
            </span>
            {!b.undoneAt && (
              <Button size="sm" onClick={() => setUndoing(b)}>
                Undo
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Confirm
        open={undoing !== null}
        onOpenChange={(open) => !open && setUndoing(null)}
        title="Undo this batch?"
        action="Undo"
        busy={busy}
        onConfirm={() => {
          if (!undoing) return;
          setBusy(true);
          void undoBatch(queryClient, undoing.id).finally(() => {
            setBusy(false);
            setUndoing(null);
          });
        }}
      >
        Saves the songs back and puts playlist songs back where they were. Songs saved again get today as their saved date.
      </Confirm>
    </Section>
  );
}

function Blocks({ items }: { items: Block[] }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<number | null>(null);
  const unblock = async (b: Block) => {
    setPending(b.id);
    try {
      await request(`/api/blocks/${b.id}`, { method: "DELETE" });
      showToast(`${b.label} can be picked again`);
      await queryClient.invalidateQueries({ queryKey: ["blocks"] });
    } catch (error) {
      showToast(describeError(error), "problem");
    } finally {
      setPending(null);
    }
  };
  return (
    <Section title="Kept out of picks and sets">
      <ul className="flex flex-col">
        {items.map((b) => (
          <li key={b.id} className="flex min-h-(--row-h) items-center justify-between gap-3 py-1">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-primary" title={b.label}>
                {b.label}
              </span>
              <span className="truncate text-caption text-secondary">{b.kind === "artist" ? "Artist" : "Song"}</span>
            </span>
            <Button size="sm" variant="ghost" busy={pending === b.id} busyLabel="Allowing" onClick={() => void unblock(b)}>
              Allow
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Library() {
  const [kind, setKind] = useState<CleanupKind>("saved_dislike");
  const summary = useCleanup(undefined, "open");
  const batches = useCleanupBatches();
  const blocks = useBlocks();
  const lib = summary.data?.library;
  const counts = summary.data?.counts;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const side = (batches.data?.items.length ?? 0) > 0 || (blocks.data?.items.length ?? 0) > 0;
  const neverSynced = lib && !lib.lastSyncAt && !lib.syncing;
  return (
    <Page>
      <PageHeader
        title="Library"
        description={
          lib &&
          (lib.syncing
            ? `${fmtInt(lib.savedTracks)} saved songs and ${fmtInt(lib.playlists)} playlists. Syncing now.`
            : lib.lastSyncAt
              ? `${fmtInt(lib.savedTracks)} saved songs and ${fmtInt(lib.playlists)} playlists, synced ${fmtAgo(lib.lastSyncAt)}.`
              : undefined)
        }
      />
      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : neverSynced && total === 0 ? (
        <EmptyState
          size="page"
          icon={BroomIcon}
          title="Your library has not synced yet"
          description="encore reads your saved songs and playlists once Spotify is connected, then proposes what could go."
          action={
            <AppLink to="/setup" className="font-medium text-primary underline underline-offset-2">
              Set up encore
            </AppLink>
          }
        />
      ) : (
        <div className={cx("grid gap-10", side && "lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:gap-12")}>
          <TabsRoot value={kind} onValueChange={(v) => setKind(v as CleanupKind)} className="flex min-w-0 flex-col gap-4">
            <div className="hairline-b">
              <TabList
                label="Proposals"
                options={KINDS.map((k) => ({
                  value: k.value,
                  label: (
                    <>
                      {k.label}
                      {counts && <span className="text-tertiary tabular">{fmtInt(counts[k.value])}</span>}
                    </>
                  ),
                }))}
              />
            </div>
            <TabPanel value={kind}>
              <Proposals key={kind} kind={kind} />
            </TabPanel>
          </TabsRoot>
          {side && (
            <div className="flex min-w-0 flex-col gap-10">
              {batches.data && batches.data.items.length > 0 && <Batches items={batches.data.items} />}
              {blocks.data && blocks.data.items.length > 0 && <Blocks items={blocks.data.items} />}
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

