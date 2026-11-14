import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { request } from "../../api/client";
import type { Batch } from "../../api/types";
import { RateMeter } from "../../charts/RateMeter";
import { fmtAgo, fmtInt } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { describeError } from "../../ui/States";
import { doneLine, songs } from "./words";

/** Replaces one batch in the cached list, so the page shows the server's answer before the next poll. */
export function useBatchCache() {
  const queryClient = useQueryClient();
  return async (batch: Batch) => {
    queryClient.setQueryData<{ items: Batch[] }>(["library", "batches"], (old) => ({
      items: old ? (old.items.some((b) => b.id === batch.id) ? old.items.map((b) => (b.id === batch.id ? batch : b)) : [batch, ...old.items]) : [batch],
    }));
    await queryClient.invalidateQueries({ queryKey: ["library"], predicate: (q) => q.queryKey[1] !== "batches" && q.queryKey[1] !== "analysis" });
  };
}

export function useUndo() {
  const replace = useBatchCache();
  const [pending, setPending] = useState<number | null>(null);
  const undo = async (id: number) => {
    setPending(id);
    try {
      const { batch } = await request<{ batch: Batch }>(`/api/library/batches/${id}/undo`, { method: "POST" });
      await replace(batch);
    } catch (error) {
      showToast(describeError(error), "problem");
    } finally {
      setPending(null);
    }
  };
  return { undo, pending };
}

/** "Spotify API 502: Bad gateway" reads as "Spotify answered 502: Bad gateway". */
const spotifyError = (e: string) => e.replace(/^Spotify API (\d+):\s*/, "Spotify answered $1: ");

const working = (b: Batch) => b.status === "running" || b.undo.status === "running";

/**
 * Says when an apply or undo this page watched comes to an end, with Undo on a finished apply.
 * Only transitions seen on this page count: opening the page on a finished batch says nothing.
 */
export function useBatchEndings(batches: Batch[] | undefined, undo: (id: number) => void) {
  const seen = useRef(new Map<number, string>());
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!batches) return;
    let ended = false;
    for (const b of batches) {
      const key = `${b.status}:${b.undo.status}`;
      const before = seen.current.get(b.id);
      seen.current.set(b.id, key);
      if (!before || before === key) continue;
      const [was, wasUndo] = before.split(":");
      if (was === "running" && b.status !== "running") {
        ended = true;
        if (b.status === "done") showToast(doneLine(b.actions), "info", b.canUndo ? { label: "Undo", onClick: () => undo(b.id) } : undefined);
        else if (b.status === "partial") showToast(`Applied ${fmtInt(b.applied)} of ${fmtInt(b.selected)}. The rest are still in the plan.`, "problem");
        else showToast("Nothing was applied. The songs are still in the plan.", "problem");
      }
      if (wasUndo === "running" && b.undo.status !== "running") {
        ended = true;
        showToast(b.undo.status === "done" ? "Undone" : "Undo stopped part way. Undo again to finish.", b.undo.status === "done" ? "info" : "problem");
      }
    }
    if (ended) void queryClient.invalidateQueries({ queryKey: ["library"], predicate: (q) => q.queryKey[1] !== "batches" });
  }, [batches, undo, queryClient]);
}

/** One apply as the server reports it: progress while running, what was and was not applied, and Undo. */
export function BatchStatus({ batch, onUndo, undoing, className }: { batch: Batch; onUndo: () => void; undoing: boolean; className?: string }) {
  const done = batch.applied + batch.skipped.length;
  const undo = batch.undo;
  const busy = working(batch);
  const line = (() => {
    if (batch.status === "running") return `Applying ${fmtInt(done)} of ${changesWord(batch.selected)}`;
    if (undo.status === "running") return "Undoing";
    if (undo.status === "done") return `Undone ${fmtAgo(undo.undoneAt!)}`;
    if (batch.status === "failed") return "Nothing was applied";
    if (batch.status === "partial") return `${doneLine(batch.actions)}. ${songs(batch.notApplied.length)} not applied`;
    return `${doneLine(batch.actions)} ${fmtAgo(batch.finishedAt ?? batch.appliedAt)}`;
  })();
  const problem =
    undo.status === "failed"
      ? `Undo stopped part way${undo.error ? `. ${spotifyError(undo.error)}` : ""}. Undo again to finish.`
      : batch.status !== "running" && batch.status !== "done" && undo.status !== "done"
        ? `${batch.error ? `${spotifyError(batch.error)}. ` : ""}The songs not applied are still in the plan.`
        : null;
  return (
    <div role="status" className={cx("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 text-pretty text-primary">{line}</p>
        {!busy && (batch.canUndo || undo.status === "failed") && undo.status !== "done" && (
          <Button size="sm" busy={undoing} busyLabel="Undoing" onClick={onUndo}>
            {undo.status === "failed" ? "Undo again" : "Undo"}
          </Button>
        )}
      </div>
      {batch.status === "running" && <RateMeter rate={batch.selected ? done / batch.selected : 0} className="w-full max-w-80" />}
      {problem && <p className="text-secondary text-pretty">{problem}</p>}
      {batch.skipped.length > 0 && undo.status !== "done" && (
        <details className="group">
          <summary className="w-fit cursor-pointer rounded-xs text-secondary underline decoration-line-strong underline-offset-2 hover:text-primary">
            {songs(batch.skipped.length)} skipped
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {batch.skipped.map((s) => (
              <li key={s.id} className="flex flex-col text-caption">
                <span className="truncate text-primary">
                  {s.name} <span className="text-secondary">by {s.artist}</span>
                </span>
                <span className="text-secondary">{s.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const changesWord = (n: number) => `${fmtInt(n)} ${n === 1 ? "change" : "changes"}`;
