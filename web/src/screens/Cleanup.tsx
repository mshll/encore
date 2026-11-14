import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, request } from "../api/client";
import { useCleanup, useCleanupBatches, useTimezone } from "../api/queries";
import type { CleanupBatch, CleanupKind, CleanupProposal } from "../api/types";
import { fmtAgo, fmtDate, fmtInt, fmtPct } from "../lib/format";
import { showToast } from "../lib/toast";
import { AppLink, songPath } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Confirm } from "../ui/Confirm";
import { Page, Section } from "../ui/Page";
import { Segmented } from "../ui/Segmented";
import { Empty, ErrorState, SkeletonRows } from "../ui/states";

const KINDS: { value: CleanupKind; label: string; empty: string }[] = [
  { value: "saved_dislike", label: "Saved, mostly skipped", empty: "No saved song is one you mostly skip." },
  { value: "saved_never_played", label: "Saved, never played", empty: "Every song saved over 30 days ago has been played." },
  { value: "playlist_skipped", label: "Skipped in playlists", empty: "No song in your playlists is skipped 9 times in 10." },
  { value: "playlist_duplicate", label: "Duplicates", empty: "No playlist has the same song twice." },
];

const songs = (n: number) => `${fmtInt(n)} ${n === 1 ? "song" : "songs"}`;

function consequence(kind: CleanupKind, n: number) {
  if (kind === "playlist_duplicate") return `Removes the extra copies of ${songs(n)} from their playlists. The first copy stays.`;
  if (kind === "playlist_skipped") return `Removes ${songs(n)} from their playlists, every copy.`;
  return `Removes ${songs(n)} from your saved songs.`;
}

function Evidence({ p, timezone }: { p: CleanupProposal; timezone: string }) {
  const e = p.evidence;
  const parts = [
    e.playlistName,
    p.kind === "playlist_duplicate" && e.duplicates ? `${e.duplicates.length + 1} copies` : null,
    `${fmtInt(e.plays)} ${e.plays === 1 ? "play" : "plays"}`,
    e.skipRate !== null ? `${fmtPct(e.skipRate)} skipped` : null,
    e.lastPlayed ? `last played ${fmtDate(e.lastPlayed, timezone)}` : "never played",
    e.savedAt ? `saved ${fmtDate(e.savedAt, timezone)}` : null,
  ].filter(Boolean);
  return <span className="text-body-sm text-secondary tabular">{parts.join(" · ")}</span>;
}

function ProposalRow({ p, checked, onToggle, timezone }: { p: CleanupProposal; checked: boolean; onToggle: () => void; timezone: string }) {
  const id = `proposal-${p.id}`;
  return (
    <li className="flex items-center gap-3 py-2">
      <input id={id} type="checkbox" checked={checked} onChange={onToggle} className="size-5 shrink-0 accent-(--accent)" />
      <Artwork src={p.evidence.albumArtUrl} name={p.evidence.name} className="size-11 md:size-10" />
      <div className="flex min-w-0 flex-1 flex-col">
        <label htmlFor={id} className="truncate font-medium text-primary">
          {p.evidence.name}
        </label>
        <span className="truncate text-body-sm text-secondary">
          {p.evidence.songKey ? (
            <AppLink to={songPath(p.evidence.songKey)} className="hover-fine:text-primary">
              {p.evidence.artist}
            </AppLink>
          ) : (
            p.evidence.artist
          )}
        </span>
        <Evidence p={p} timezone={timezone} />
      </div>
    </li>
  );
}

function BatchRow({ batch, onUndo }: { batch: CleanupBatch; onUndo: () => void }) {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="font-medium text-primary">
          {fmtInt(batch.actions)} {batch.actions === 1 ? "removal" : "removals"}
        </span>
        <span className="text-body-sm text-secondary">
          Applied {fmtAgo(batch.appliedAt)}
          {batch.undoneAt && `, undone ${fmtAgo(batch.undoneAt)}`}
        </span>
      </div>
      {!batch.undoneAt && (
        <button type="button" className="btn btn-secondary" onClick={onUndo}>
          Undo
        </button>
      )}
    </li>
  );
}

export default function Cleanup() {
  const [kind, setKind] = useState<CleanupKind>("saved_dislike");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<"apply" | "dismiss" | null>(null);
  const [undoing, setUndoing] = useState<CleanupBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useCleanup(kind, "open");
  const batches = useCleanupBatches();
  const timezone = useTimezone();
  const queryClient = useQueryClient();
  const d = q.data;
  const items = d && !q.isPlaceholderData ? d.items : [];

  const ids = items.filter((p) => selected.has(p.id)).map((p) => p.id);
  const allSelected = items.length > 0 && ids.length === items.length;
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      setConfirm(null);
      setUndoing(null);
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: ["cleanup"] });
    }
  };

  const apply = () =>
    run(async () => {
      try {
        const r = await request<{ batchId: number; applied: number }>("/api/cleanup/apply", { json: { ids } });
        showToast(`Removed ${songs(r.applied)}. You can undo this from the batch list.`);
      } catch (error) {
        if (error instanceof ApiError && error.code === "cleanup_partial")
          showToast("Spotify stopped part way. What was removed is in the batch list, where you can undo it.", "problem");
        else showToast(error instanceof ApiError ? error.message : "Could not reach encore. Try again.", "problem");
      }
    });

  const dismiss = () =>
    run(async () => {
      try {
        const r = await request<{ dismissed: number }>("/api/cleanup/dismiss", { json: { ids } });
        showToast(`Dismissed ${songs(r.dismissed)}.`);
      } catch (error) {
        showToast(error instanceof ApiError ? error.message : "Could not reach encore. Try again.", "problem");
      }
    });

  const undo = (batch: CleanupBatch) =>
    run(async () => {
      try {
        const r = await request<{ restored: number }>(`/api/cleanup/batches/${batch.id}/undo`, { method: "POST" });
        showToast(`Restored ${songs(r.restored)}.`);
      } catch (error) {
        showToast(error instanceof ApiError ? error.message : "Could not reach encore. Try again.", "problem");
      }
    });

  const current = KINDS.find((k) => k.value === kind)!;
  const library = d?.library;

  return (
    <Page title="Cleanup">
      <div className="flex flex-col gap-3">
        <Segmented
          label="Proposal type"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setSelected(new Set());
          }}
          options={KINDS.map((k) => ({
            value: k.value,
            label: (
              <>
                {k.label}
                {d && <span className="text-tertiary tabular">{fmtInt(d.counts[k.value])}</span>}
              </>
            ),
          }))}
        />
        {library && (
          <p className="text-body-sm text-secondary">
            {fmtInt(library.savedTracks)} saved songs and {fmtInt(library.playlists)} playlists.{" "}
            {library.syncing ? "Syncing your library now." : library.lastSyncAt ? `Library synced ${fmtAgo(library.lastSyncAt)}.` : "Library not synced yet."}
          </p>
        )}
      </div>

      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d || q.isPlaceholderData ? (
        <SkeletonRows rows={6} />
      ) : items.length === 0 ? (
        <Empty title="Nothing to clean up">{current.empty}</Empty>
      ) : (
        <Section>
          <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 bg-canvas px-4 py-2 md:-mx-2 md:px-2">
            <label className="flex items-center gap-3 text-body-base font-medium">
              <input
                type="checkbox"
                className="size-5 accent-(--accent)"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = ids.length > 0 && !allSelected;
                }}
                onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((p) => p.id)))}
              />
              {ids.length > 0 ? `${fmtInt(ids.length)} selected` : `Select all ${fmtInt(items.length)}`}
            </label>
            <div className="flex gap-2">
              <button type="button" className="btn btn-secondary" disabled={ids.length === 0 || busy} onClick={() => setConfirm("dismiss")}>
                Dismiss
              </button>
              <button type="button" className="btn btn-danger" disabled={ids.length === 0 || busy} onClick={() => setConfirm("apply")}>
                Remove
              </button>
            </div>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {items.map((p) => (
              <ProposalRow key={p.id} p={p} checked={selected.has(p.id)} onToggle={() => toggle(p.id)} timezone={timezone} />
            ))}
          </ul>
        </Section>
      )}

      {batches.data && batches.data.items.length > 0 && (
        <Section title="Batches">
          <ul className="flex flex-col divide-y divide-border">
            {batches.data.items.map((b) => (
              <BatchRow key={b.id} batch={b} onUndo={() => setUndoing(b)} />
            ))}
          </ul>
        </Section>
      )}

      <Confirm
        open={confirm === "apply"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Remove ${songs(ids.length)}?`}
        action={busy ? "Removing" : "Remove"}
        danger
        busy={busy}
        onConfirm={apply}
      >
        {consequence(kind, ids.length)} You can undo this from the batch list.
      </Confirm>
      <Confirm
        open={confirm === "dismiss"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Dismiss ${songs(ids.length)}?`}
        action="Dismiss"
        busy={busy}
        onConfirm={dismiss}
      >
        They stop being proposed. Nothing changes in Spotify.
      </Confirm>
      <Confirm
        open={undoing !== null}
        onOpenChange={(open) => !open && setUndoing(null)}
        title="Undo this batch?"
        action={busy ? "Restoring" : "Undo"}
        busy={busy}
        onConfirm={() => undoing && undo(undoing)}
      >
        Saves the songs back and puts playlist songs back where they were. Songs saved again get today as their saved date.
      </Confirm>
    </Page>
  );
}
