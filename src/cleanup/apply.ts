import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { cleanupBatches, cleanupProposals, playlistItems, savedTracks, type UndoAction } from "../db/schema";
import type { SpotifyClient } from "../spotify/client";

export class CleanupSelectionError extends Error {
  constructor(
    message: string,
    readonly ids: number[] = [],
  ) {
    super(message);
  }
}

export class CleanupPartialError extends Error {
  constructor(
    readonly batchId: number,
    override readonly cause: unknown,
  ) {
    super(`Cleanup stopped part way: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

type Proposal = typeof cleanupProposals.$inferSelect;
type Evidence = { positions?: number[]; uris?: string[]; keep?: { position: number; uri: string }; duplicates?: { position: number; uri: string }[] };

const LIBRARY_BATCH = 40;

const chunk = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function removeFromLibrary(spotify: SpotifyClient, uris: string[]) {
  for (const batch of chunk(uris, LIBRARY_BATCH)) await spotify.request("DELETE", `/me/library?uris=${batch.map(encodeURIComponent).join(",")}`);
}

async function saveToLibrary(spotify: SpotifyClient, uris: string[]) {
  for (const batch of chunk(uris, LIBRARY_BATCH)) await spotify.request("PUT", `/me/library?uris=${batch.map(encodeURIComponent).join(",")}`);
}

async function removeFromPlaylist(spotify: SpotifyClient, playlistId: string, uris: string[]) {
  await spotify.request("DELETE", `/playlists/${playlistId}/items`, { items: uris.map((uri) => ({ uri })) });
}

async function insertIntoPlaylist(spotify: SpotifyClient, playlistId: string, uri: string, position: number) {
  await spotify.request("POST", `/playlists/${playlistId}/items`, { uris: [uri], position });
}

function playlistPositions(db: Db, playlistId: string, uri: string): number[] {
  return db
    .select({ position: playlistItems.position })
    .from(playlistItems)
    .where(and(eq(playlistItems.playlistId, playlistId), eq(playlistItems.uri, uri)))
    .orderBy(playlistItems.position)
    .all()
    .map((r) => r.position);
}

type Removed = Map<string, number[]>;

async function removeOccurrences(db: Db, spotify: SpotifyClient, removed: Removed, playlistId: string, uri: string, keepPosition?: number): Promise<UndoAction> {
  const positions = playlistPositions(db, playlistId, uri);
  await removeFromPlaylist(spotify, playlistId, [uri]);
  removed.set(playlistId, [...(removed.get(playlistId) ?? []), ...positions]);
  return { type: "playlist_insert", playlistId, uri, positions: positions.filter((p) => p !== keepPosition) };
}

async function applyOne(db: Db, spotify: SpotifyClient, removed: Removed, p: Proposal): Promise<UndoAction[]> {
  if (p.kind === "saved_never_played" || p.kind === "saved_dislike") {
    await removeFromLibrary(spotify, [p.uri]);
    db.delete(savedTracks).where(eq(savedTracks.uri, p.uri)).run();
    return [{ type: "library_save", uris: [p.uri] }];
  }
  const playlistId = p.playlistId!;
  const evidence = p.evidence as Evidence;
  const undo: UndoAction[] = [];
  if (p.kind === "playlist_skipped") {
    for (const uri of evidence.uris ?? [p.uri]) undo.push(await removeOccurrences(db, spotify, removed, playlistId, uri));
    return undo;
  }
  const keep = evidence.keep!;
  for (const uri of new Set([keep.uri, ...(evidence.duplicates ?? []).map((d) => d.uri)])) {
    undo.push(await removeOccurrences(db, spotify, removed, playlistId, uri, uri === keep.uri ? keep.position : undefined));
  }
  const shift = (removed.get(playlistId) ?? []).filter((position) => position < keep.position).length;
  await insertIntoPlaylist(spotify, playlistId, keep.uri, keep.position - shift);
  return undo;
}

export async function applyCleanup(db: Db, spotify: SpotifyClient, ids: number[], now: number) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new CleanupSelectionError("Choose at least one proposal");
  const proposals = db.select().from(cleanupProposals).where(inArray(cleanupProposals.id, unique)).all();
  const notOpen = unique.filter((id) => !proposals.some((p) => p.id === id && p.status === "open"));
  if (notOpen.length) throw new CleanupSelectionError("Some proposals are not open", notOpen);
  const undo: UndoAction[] = [];
  const applied: number[] = [];
  const removed: Removed = new Map();
  let failure: unknown = null;
  for (const p of proposals) {
    try {
      undo.push(...(await applyOne(db, spotify, removed, p)));
      applied.push(p.id);
    } catch (error) {
      failure = error;
      break;
    }
  }
  const batch = db.insert(cleanupBatches).values({ proposalIds: applied, undo, appliedAt: now }).returning().get();
  if (applied.length) db.update(cleanupProposals).set({ status: "applied", updatedAt: now }).where(inArray(cleanupProposals.id, applied)).run();
  if (failure) throw new CleanupPartialError(batch.id, failure);
  return { batchId: batch.id, applied: applied.length };
}

export async function undoCleanup(db: Db, spotify: SpotifyClient, batchId: number, now: number) {
  const batch = db.select().from(cleanupBatches).where(eq(cleanupBatches.id, batchId)).get();
  if (!batch) throw new CleanupSelectionError("Unknown batch");
  if (batch.undoneAt) throw new CleanupSelectionError("Batch already undone");
  const libraryUris = batch.undo.flatMap((a) => (a.type === "library_save" ? a.uris : []));
  if (libraryUris.length) await saveToLibrary(spotify, libraryUris);
  const inserts = batch.undo
    .flatMap((a) => (a.type === "playlist_insert" ? a.positions.map((position) => ({ playlistId: a.playlistId, uri: a.uri, position })) : []))
    .sort((a, b) => a.playlistId.localeCompare(b.playlistId) || a.position - b.position);
  for (const insert of inserts) await insertIntoPlaylist(spotify, insert.playlistId, insert.uri, insert.position);
  db.update(cleanupBatches).set({ undoneAt: now }).where(eq(cleanupBatches.id, batchId)).run();
  if (batch.proposalIds.length) db.update(cleanupProposals).set({ status: "open", updatedAt: now }).where(inArray(cleanupProposals.id, batch.proposalIds)).run();
  return { batchId, restored: batch.proposalIds.length };
}

export function listBatches(db: Db, limit: number) {
  return db
    .select()
    .from(cleanupBatches)
    .orderBy(desc(cleanupBatches.id))
    .limit(limit)
    .all()
    .map((b) => ({ id: b.id, proposalIds: b.proposalIds, actions: b.undo.length, appliedAt: new Date(b.appliedAt).toISOString(), undoneAt: b.undoneAt ? new Date(b.undoneAt).toISOString() : null }));
}
