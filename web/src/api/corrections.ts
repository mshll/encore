import { useQueryClient } from "@tanstack/react-query";
import { fmtInt } from "../lib/format";
import { showToast } from "../lib/toast";
import { describeError } from "../ui/States";
import { request, withQuery } from "./client";
import type { ArtistAlias } from "./types";

const plural = (n: number) => `${fmtInt(n)} ${n === 1 ? "play" : "plays"}`;

/**
 * Deleting plays and counting one artist as another. Both change every figure, so each refreshes all queries,
 * and each says what happened in a toast with its undo.
 */
export function useCorrections() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries();
  const attempt = async <T>(run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      showToast(describeError(error), "problem");
      return null;
    }
  };

  const restore = async (ids: number[]) => {
    const done = await attempt(() => request<{ restored: number }>("/api/plays/restore", { json: { ids } }));
    if (!done) return;
    await refresh();
    showToast(`Restored ${plural(done.restored)}`);
  };

  const trash = async (ids: number[]) => {
    const done = await attempt(() => request<{ trashed: number }>("/api/plays/trash", { json: { ids } }));
    if (!done) return;
    await refresh();
    showToast(`Deleted ${plural(done.trashed)}`, "info", { label: "Undo", onClick: () => void restore(ids) });
  };

  const trashSong = async (songKey: string, range: { from?: string; to?: string }) => {
    const done = await attempt(() => request<{ trashed: number; ids: number[] }>("/api/plays/trash/song", { json: { songKey, ...range } }));
    if (!done) return;
    await refresh();
    showToast(`Deleted ${plural(done.trashed)}`, "info", { label: "Undo", onClick: () => void restore(done.ids) });
  };

  const emptyTrash = async () => {
    const done = await attempt(() => request<{ deleted: number }>("/api/plays/trash", { method: "DELETE" }));
    if (!done) return;
    await refresh();
    showToast(`Deleted ${plural(done.deleted)} for good`);
  };

  const removeAlias = async (alias: string, quiet = false) => {
    const done = await attempt(() => request<{ removed: string }>(withQuery("/api/artists/aliases", { alias }), { method: "DELETE" }));
    if (!done) return false;
    await refresh();
    if (!quiet) showToast(`${alias} counts as itself again`);
    return true;
  };

  const addAlias = async (alias: string, canonical: string) => {
    const done = await attempt(() => request<ArtistAlias>("/api/artists/aliases", { json: { alias, canonical } }));
    if (!done) return false;
    await refresh();
    showToast(`${alias} now counts as ${canonical}`, "info", { label: "Undo", onClick: () => void removeAlias(alias, true) });
    return true;
  };

  return { trash, trashSong, restore, emptyTrash, addAlias, removeAlias };
}
