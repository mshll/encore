import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { appPlaylists, cleanupBatches, cleanupProposals, libraryPlans, ownedPlaylists, playlistItems, savedTracks, type BatchStatus, type PlanAction, type UndoAction } from "../db/schema";
import type { SpotifyClient } from "../spotify/client";
import { SpotifyBlockedError, SpotifyNotConnectedError } from "../spotify/errors";
import { inForeground } from "../spotify/pacer";
import { appOwnedPlaylistIds } from "./owned";
import { actionOf, PlanNotFoundError, PlanSelectionError, TAKE_OUT } from "./plans";

const LIBRARY_BATCH = 40;
const PLAYLIST_BATCH = 100;
const ARCHIVE = { purpose: "archive", name: "encore archive", description: "Songs encore archived from your liked songs and playlists." };

export class BatchNotFoundError extends Error {}
export class BatchBusyError extends Error {
  constructor() {
    super("Another change is still being applied or undone");
  }
}

type Item = typeof cleanupProposals.$inferSelect;
type Batch = typeof cleanupBatches.$inferSelect;
type Work = { item: Item; action: PlanAction; songKey: string };
type Method = "GET" | "POST" | "PUT" | "DELETE";

export type ApplyDeps = { db: Db; spotify: SpotifyClient; now: () => number };
export type Started = { batchId: number; finished: Promise<void> };

const chunk = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
const libraryPath = (uris: string[]) => `/me/library?uris=${uris.map(encodeURIComponent).join(",")}`;

/** Every write and its undo entry are saved as soon as Spotify accepts the call, so the batch row is the true state while it runs and after it stops. */
class BatchLog {
  calls = 0;

  constructor(
    private readonly db: Db,
    readonly id: number,
    private readonly now: () => number,
  ) {}

  row(): Batch {
    return this.db.select().from(cleanupBatches).where(eq(cleanupBatches.id, this.id)).get()!;
  }

  private set(patch: Partial<Batch>) {
    this.db.update(cleanupBatches).set(patch).where(eq(cleanupBatches.id, this.id)).run();
  }

  async request<T>(spotify: SpotifyClient, method: Method, path: string, body?: unknown): Promise<T> {
    this.calls++;
    this.set({ calls: this.calls });
    return spotify.request<T>(method, path, body);
  }

  undo(action: UndoAction) {
    this.set({ undo: [...this.row().undo, action] });
  }

  setUndo(undo: UndoAction[]) {
    this.set({ undo });
  }

  applied(items: Item[]) {
    if (items.length === 0) return;
    const ids = items.map((i) => i.id);
    this.set({ proposalIds: [...this.row().proposalIds, ...ids] });
    this.db.update(cleanupProposals).set({ status: "applied", updatedAt: this.now() }).where(inArray(cleanupProposals.id, ids)).run();
  }

  skip(items: Item[], reason: string) {
    if (items.length === 0) return;
    const ids = items.map((i) => i.id);
    this.set({ skipped: [...this.row().skipped, ...ids.map((id) => ({ id, reason }))] });
    this.db.update(cleanupProposals).set({ status: "skipped", updatedAt: this.now() }).where(inArray(cleanupProposals.id, ids)).run();
  }

  finish(status: BatchStatus, error: string | null = null) {
    this.set({ status, error, finishedAt: this.now() });
  }
}

const busy = (db: Db) =>
  db
    .select({ id: cleanupBatches.id })
    .from(cleanupBatches)
    .where(or(eq(cleanupBatches.status, "running"), eq(cleanupBatches.undoStatus, "running")))
    .get() !== undefined;

const songKeyOf = (db: Db, item: Item): string =>
  (item.evidence.songKey as string | undefined) ?? db.all<{ k: string }>(sql`select song_key as k from tracks where uri = ${item.uri}`)[0]?.k ?? item.uri;

type PlaylistRow = { position: number; uri: string; addedAt: number | null; songKey: string };

function playlistRows(db: Db, playlistId: string): PlaylistRow[] {
  return db.all<PlaylistRow>(sql`
    select i.position, i.uri, i.added_at as addedAt, coalesce(t.song_key, i.uri) as songKey
    from playlist_items i left join tracks t on t.uri = i.uri where i.playlist_id = ${playlistId} order by i.position`);
}

function writeMirror(db: Db, playlistId: string, rows: { uri: string; addedAt: number | null }[], snapshotId: string | null) {
  db.transaction((tx) => {
    tx.delete(playlistItems).where(eq(playlistItems.playlistId, playlistId)).run();
    if (rows.length) tx.insert(playlistItems).values(rows.map((r, position) => ({ playlistId, position, uri: r.uri, addedAt: r.addedAt }))).run();
    tx.update(ownedPlaylists).set({ itemCount: rows.length, snapshotId }).where(eq(ownedPlaylists.id, playlistId)).run();
  });
}

/** Checks each item against the library as last synced. Returns the items still valid and why the others are stale. */
function revalidate(db: Db, items: Item[]): { ok: Work[]; stale: Map<string, Item[]> } {
  const saved = new Set(db.select({ uri: savedTracks.uri }).from(savedTracks).all().map((r) => r.uri));
  const savedKeys = new Set(db.all<{ k: string }>(sql`select t.song_key as k from saved_tracks s join tracks t on t.uri = s.uri`).map((r) => r.k));
  const appOwned = new Set(appOwnedPlaylistIds(db));
  const owned = new Set(db.select({ id: ownedPlaylists.id }).from(ownedPlaylists).all().map((r) => r.id));
  const rows = new Map<string, PlaylistRow[]>();
  const rowsOf = (id: string) => rows.get(id) ?? rows.set(id, playlistRows(db, id)).get(id)!;
  const ok: Work[] = [];
  const stale = new Map<string, Item[]>();
  const seen = new Set<string>();
  const reject = (item: Item, reason: string) => stale.set(reason, [...(stale.get(reason) ?? []), item]);
  for (const item of items) {
    const action = actionOf(item);
    const songKey = songKeyOf(db, item);
    const where = item.playlistId;
    if (seen.has(`${where}|${songKey}`)) {
      reject(item, "Already in this plan");
      continue;
    }
    seen.add(`${where}|${songKey}`);
    if (where === null) {
      if (TAKE_OUT.includes(action) && !saved.has(item.uri)) reject(item, "No longer in your liked songs");
      else if (action === "save" && savedKeys.has(songKey)) reject(item, "Already in your liked songs");
      else ok.push({ item, action, songKey });
      continue;
    }
    if (!owned.has(where) || appOwned.has(where)) {
      reject(item, "Not one of your playlists any more");
      continue;
    }
    const copies = rowsOf(where).filter((r) => r.songKey === songKey).length;
    if (TAKE_OUT.includes(action) && copies === 0) reject(item, "No longer in the playlist");
    else if (action === "dedupe" && copies < 2) reject(item, "No longer has extra copies");
    else if (action === "add" && copies > 0) reject(item, "Already in the playlist");
    else ok.push({ item, action, songKey });
  }
  return { ok, stale };
}

async function ensureArchive(deps: ApplyDeps, log: BatchLog): Promise<string> {
  const existing = deps.db.select().from(appPlaylists).where(eq(appPlaylists.purpose, ARCHIVE.purpose)).get();
  if (existing) return existing.playlistId;
  const created = await log.request<{ id: string }>(deps.spotify, "POST", "/me/playlists", { name: ARCHIVE.name, description: ARCHIVE.description, public: false });
  deps.db.insert(appPlaylists).values({ purpose: ARCHIVE.purpose, playlistId: created.id, createdAt: deps.now() }).run();
  return created.id;
}

/**
 * Starts applying the plan's ticked open items and returns at once. The work goes on without the caller; read its state
 * from the batch. Only one apply or undo runs at a time.
 */
export function startApply(deps: ApplyDeps, planId: number): Started {
  const { db, now } = deps;
  const plan = db.select().from(libraryPlans).where(eq(libraryPlans.id, planId)).get();
  if (!plan) throw new PlanNotFoundError();
  if (plan.status !== "open") throw new PlanSelectionError("The plan is not open");
  if (busy(db)) throw new BatchBusyError();
  const items = db
    .select()
    .from(cleanupProposals)
    .where(and(eq(cleanupProposals.planId, planId), eq(cleanupProposals.status, "open"), eq(cleanupProposals.included, true)))
    .orderBy(cleanupProposals.id)
    .all();
  if (items.length === 0) throw new PlanSelectionError("Nothing is selected in this plan");
  const batch = db
    .insert(cleanupBatches)
    .values({ planId, proposalIds: [], selectedIds: items.map((i) => i.id), undo: [], status: "running", appliedAt: now() })
    .returning()
    .get();
  const log = new BatchLog(db, batch.id, now);
  const finished = inForeground(() => runApply(deps, log, items)).then(() => settlePlan(db, planId, now()));
  return { batchId: batch.id, finished };
}

function settlePlan(db: Db, planId: number, now: number) {
  const plan = db.select().from(libraryPlans).where(eq(libraryPlans.id, planId)).get()!;
  if (plan.source === "rule") return;
  const open = db
    .select({ id: cleanupProposals.id })
    .from(cleanupProposals)
    .where(and(eq(cleanupProposals.planId, planId), eq(cleanupProposals.status, "open"), eq(cleanupProposals.included, true)))
    .get();
  db.update(libraryPlans)
    .set({ status: open ? "open" : "applied", updatedAt: now })
    .where(eq(libraryPlans.id, planId))
    .run();
}

const failureMessage = (error: unknown) => {
  if (error instanceof SpotifyBlockedError) return `Spotify paused calls until ${new Date(error.blockedUntil).toISOString()}`;
  if (error instanceof SpotifyNotConnectedError) return "Spotify is not connected";
  return error instanceof Error ? error.message : String(error);
};

async function runApply(deps: ApplyDeps, log: BatchLog, items: Item[]) {
  const { db, spotify } = deps;
  try {
    const { ok, stale } = revalidate(db, items);
    for (const [reason, skipped] of stale) log.skip(skipped, reason);
    let work = ok;

    const playlists = [...new Set(work.flatMap((w) => (w.item.playlistId ? [w.item.playlistId] : [])))].sort();
    for (const id of playlists) {
      const remote = await log.request<{ snapshot_id: string }>(spotify, "GET", `/playlists/${id}?fields=snapshot_id`);
      const stored = db.select({ snapshotId: ownedPlaylists.snapshotId }).from(ownedPlaylists).where(eq(ownedPlaylists.id, id)).get()?.snapshotId;
      if (remote.snapshot_id === stored) continue;
      log.skip(
        work.filter((w) => w.item.playlistId === id).map((w) => w.item),
        "The playlist changed in Spotify since the last sync",
      );
      db.update(ownedPlaylists).set({ syncedAt: null }).where(eq(ownedPlaylists.id, id)).run();
      work = work.filter((w) => w.item.playlistId !== id);
    }

    const archived = work.filter((w) => w.action === "archive");
    if (archived.length) {
      const archiveId = await ensureArchive(deps, log);
      for (const uris of chunk([...new Set(archived.map((w) => w.item.uri))], PLAYLIST_BATCH)) {
        await log.request(spotify, "POST", `/playlists/${archiveId}/items`, { uris });
        log.undo({ type: "archive_remove", playlistId: archiveId, uris });
      }
    }

    for (const group of chunk(
      work.filter((w) => w.item.playlistId === null && TAKE_OUT.includes(w.action)),
      LIBRARY_BATCH,
    )) {
      const uris = group.map((w) => w.item.uri);
      await log.request(spotify, "DELETE", libraryPath(uris));
      log.undo({ type: "library_save", uris });
      db.delete(savedTracks).where(inArray(savedTracks.uri, uris)).run();
      log.applied(group.map((w) => w.item));
    }

    for (const group of chunk(
      work.filter((w) => w.action === "save"),
      LIBRARY_BATCH,
    )) {
      const uris = group.map((w) => w.item.uri);
      await log.request(spotify, "PUT", libraryPath(uris));
      log.undo({ type: "library_remove", uris });
      const at = deps.now();
      for (const uri of uris) db.insert(savedTracks).values({ uri, addedAt: at, syncedAt: at }).onConflictDoNothing().run();
      log.applied(group.map((w) => w.item));
    }

    for (const id of playlists) await applyToPlaylist(deps, log, id, work.filter((w) => w.item.playlistId === id));

    const row = log.row();
    const notApplied = row.selectedIds.length - row.proposalIds.length - row.skipped.length;
    log.finish(notApplied === 0 ? "done" : row.proposalIds.length ? "partial" : "failed");
  } catch (error) {
    if (!(error instanceof SpotifyBlockedError)) console.error(`[library] apply batch ${log.id} stopped: ${failureMessage(error)}`);
    log.finish(log.row().proposalIds.length ? "partial" : "failed", failureMessage(error));
  }
}

/** Where each kept copy lands once every removed entry is gone: entries before it that stay, plus kept copies before it. */
export function keptTargets(original: { position: number; uri: string }[], removedUris: Set<string>, keptPositions: number[]): { position: number; target: number }[] {
  const kept = [...keptPositions].sort((a, b) => a - b);
  return kept.map((position, i) => ({ position, target: original.filter((r) => r.position < position && !removedUris.has(r.uri)).length + i }));
}

/** Groups kept copies whose targets follow on from each other, so one insert call puts back several. */
export function consecutiveRuns<T extends { target: number }>(sorted: T[]): T[][] {
  const runs: T[][] = [];
  for (const k of sorted) {
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1]!.target + 1 === k.target) last.push(k);
    else runs.push([k]);
  }
  return runs;
}

async function applyToPlaylist(deps: ApplyDeps, log: BatchLog, playlistId: string, work: Work[]) {
  const { db, spotify } = deps;
  const original = playlistRows(db, playlistId);
  const outKeys = new Set(work.filter((w) => TAKE_OUT.includes(w.action) || w.action === "dedupe").map((w) => w.songKey));
  const removeUris = [...new Set(original.filter((r) => outKeys.has(r.songKey)).map((r) => r.uri))];
  const removed = new Set<string>();
  const reinserted = new Set<number>();
  const added: { uri: string; addedAt: number | null }[] = [];
  let snapshot = db.select({ s: ownedPlaylists.snapshotId }).from(ownedPlaylists).where(eq(ownedPlaylists.id, playlistId)).get()?.s ?? null;
  const mirror = () =>
    writeMirror(
      db,
      playlistId,
      [...original.filter((r) => !removed.has(r.uri) || reinserted.has(r.position)), ...added],
      snapshot,
    );

  const takeOut = work.filter((w) => TAKE_OUT.includes(w.action));
  const appliedIds = new Set<number>();
  for (const uris of chunk(removeUris, PLAYLIST_BATCH)) {
    const res = await log.request<{ snapshot_id?: string } | null>(spotify, "DELETE", `/playlists/${playlistId}/items`, { items: uris.map((uri) => ({ uri })) });
    snapshot = res?.snapshot_id ?? null;
    for (const uri of uris) {
      removed.add(uri);
      log.undo({ type: "playlist_insert", playlistId, uri, positions: original.filter((r) => r.uri === uri).map((r) => r.position) });
    }
    mirror();
    const gone = takeOut.filter((w) => !appliedIds.has(w.item.id) && original.filter((r) => r.songKey === w.songKey).every((r) => removed.has(r.uri)));
    for (const w of gone) appliedIds.add(w.item.id);
    log.applied(gone.map((w) => w.item));
  }

  const dedupes = work.filter((w) => w.action === "dedupe");
  const keptRow = new Map(dedupes.map((w) => [original.find((r) => r.songKey === w.songKey)!.position, w]));
  const targets = keptTargets(original, removed, [...keptRow.keys()]);
  for (const run of consecutiveRuns(targets)) {
    const rows = run.map((k) => original.find((r) => r.position === k.position)!);
    const res = await log.request<{ snapshot_id?: string } | null>(spotify, "POST", `/playlists/${playlistId}/items`, { uris: rows.map((r) => r.uri), position: run[0]!.target });
    snapshot = res?.snapshot_id ?? null;
    for (const r of rows) reinserted.add(r.position);
    log.setUndo(
      log
        .row()
        .undo.map((a) => (a.type === "playlist_insert" && a.playlistId === playlistId ? { ...a, positions: a.positions.filter((p) => !reinserted.has(p)) } : a))
        .filter((a) => a.type !== "playlist_insert" || a.positions.length > 0),
    );
    mirror();
    log.applied(run.map((k) => keptRow.get(k.position)!.item));
  }

  for (const group of chunk(
    work.filter((w) => w.action === "add"),
    PLAYLIST_BATCH,
  )) {
    const uris = group.map((w) => w.item.uri);
    const res = await log.request<{ snapshot_id?: string } | null>(spotify, "POST", `/playlists/${playlistId}/items`, { uris });
    snapshot = res?.snapshot_id ?? null;
    log.undo({ type: "playlist_remove", playlistId, uris });
    const at = deps.now();
    added.push(...uris.map((uri) => ({ uri, addedAt: at })));
    mirror();
    log.applied(group.map((w) => w.item));
  }
}

/** Starts undoing a batch and returns at once. Continues where an earlier undo stopped. */
export function startUndo(deps: ApplyDeps, batchId: number): Started {
  const { db, now } = deps;
  const batch = db.select().from(cleanupBatches).where(eq(cleanupBatches.id, batchId)).get();
  if (!batch) throw new BatchNotFoundError();
  if (batch.undoneAt) throw new PlanSelectionError("Already undone");
  if (busy(db)) throw new BatchBusyError();
  db.update(cleanupBatches).set({ undoStatus: "running", undoError: null }).where(eq(cleanupBatches.id, batchId)).run();
  const log = new BatchLog(db, batchId, now);
  const finished = inForeground(() => runUndo(deps, log, batch));
  return { batchId, finished };
}

/** Archive entries another batch still relies on stay in the archive. */
function stillArchived(db: Db, batchId: number): Set<string> {
  const others = db
    .select({ undo: cleanupBatches.undo })
    .from(cleanupBatches)
    .where(and(isNull(cleanupBatches.undoneAt), sql`${cleanupBatches.id} != ${batchId}`))
    .all();
  return new Set(others.flatMap((b) => b.undo.flatMap((a) => (a.type === "archive_remove" ? a.uris : []))));
}

async function runUndo(deps: ApplyDeps, log: BatchLog, batch: Batch) {
  const { db, spotify, now } = deps;
  let remaining = [...batch.undo];
  const done = (sent: (a: UndoAction) => UndoAction | null) => {
    remaining = remaining.map(sent).filter((a): a is UndoAction => a !== null);
    log.setUndo(remaining);
  };
  try {
    for (const action of remaining.filter((a) => a.type === "playlist_remove")) {
      if (action.type !== "playlist_remove") continue;
      const res = await log.request<{ snapshot_id?: string } | null>(spotify, "DELETE", `/playlists/${action.playlistId}/items`, { items: action.uris.map((uri) => ({ uri })) });
      const rows = playlistRows(db, action.playlistId).filter((r) => !action.uris.includes(r.uri));
      writeMirror(db, action.playlistId, rows, res?.snapshot_id ?? null);
      done((a) => (a === action ? null : a));
    }

    const inserts = remaining
      .flatMap((a) => (a.type === "playlist_insert" ? a.positions.map((position) => ({ playlistId: a.playlistId, uri: a.uri, position, target: position })) : []))
      .sort((a, b) => a.playlistId.localeCompare(b.playlistId) || a.position - b.position);
    const playlists = [...new Set(inserts.map((i) => i.playlistId))];
    for (const playlistId of playlists) {
      for (const run of consecutiveRuns(inserts.filter((i) => i.playlistId === playlistId))) {
        const res = await log.request<{ snapshot_id?: string } | null>(spotify, "POST", `/playlists/${playlistId}/items`, { uris: run.map((r) => r.uri), position: run[0]!.position });
        const rows: { uri: string; addedAt: number | null }[] = playlistRows(db, playlistId);
        for (const r of run) rows.splice(r.position, 0, { uri: r.uri, addedAt: now() });
        writeMirror(db, playlistId, rows, res?.snapshot_id ?? null);
        const sent = new Set(run.map((r) => `${r.uri}@${r.position}`));
        done((a) => {
          if (a.type !== "playlist_insert" || a.playlistId !== playlistId) return a;
          const positions = a.positions.filter((p) => !sent.has(`${a.uri}@${p}`));
          return positions.length ? { ...a, positions } : null;
        });
      }
    }

    for (const type of ["library_save", "library_remove"] as const) {
      const uris = remaining.flatMap((a) => (a.type === type ? a.uris : []));
      for (const group of chunk(uris, LIBRARY_BATCH)) {
        await log.request(spotify, type === "library_save" ? "PUT" : "DELETE", libraryPath(group));
        const at = now();
        if (type === "library_save") for (const uri of group) db.insert(savedTracks).values({ uri, addedAt: at, syncedAt: at }).onConflictDoNothing().run();
        else db.delete(savedTracks).where(inArray(savedTracks.uri, group)).run();
        done((a) => {
          if (a.type !== type) return a;
          const left = a.uris.filter((u) => !group.includes(u));
          return left.length ? { ...a, uris: left } : null;
        });
      }
    }

    const keep = stillArchived(db, log.id);
    for (const action of remaining.filter((a) => a.type === "archive_remove")) {
      if (action.type !== "archive_remove") continue;
      const uris = action.uris.filter((u) => !keep.has(u));
      for (const group of chunk(uris, PLAYLIST_BATCH)) await log.request(spotify, "DELETE", `/playlists/${action.playlistId}/items`, { items: group.map((uri) => ({ uri })) });
      done((a) => (a === action ? null : a));
    }

    const at = now();
    db.update(cleanupBatches).set({ undoStatus: "done", undoneAt: at }).where(eq(cleanupBatches.id, log.id)).run();
    if (batch.proposalIds.length) db.update(cleanupProposals).set({ status: "open", updatedAt: at }).where(inArray(cleanupProposals.id, batch.proposalIds)).run();
    if (batch.planId) db.update(libraryPlans).set({ status: "open", updatedAt: at }).where(and(eq(libraryPlans.id, batch.planId), eq(libraryPlans.status, "applied"))).run();
  } catch (error) {
    if (!(error instanceof SpotifyBlockedError)) console.error(`[library] undo of batch ${log.id} stopped: ${failureMessage(error)}`);
    db.update(cleanupBatches).set({ undoStatus: "failed", undoError: failureMessage(error) }).where(eq(cleanupBatches.id, log.id)).run();
  }
}

/** After a restart nothing is running: marks what was cut off, keeping what it had applied. */
export function recoverInterrupted(db: Db, now: number) {
  const message = "Stopped when encore restarted";
  for (const b of db.select().from(cleanupBatches).where(eq(cleanupBatches.status, "running")).all())
    db.update(cleanupBatches)
      .set({ status: b.proposalIds.length ? "partial" : "failed", error: message, finishedAt: now })
      .where(eq(cleanupBatches.id, b.id))
      .run();
  db.update(cleanupBatches).set({ undoStatus: "failed", undoError: message }).where(eq(cleanupBatches.undoStatus, "running")).run();
}

export function batchView(db: Db, batch: Batch) {
  const ids = [...new Set([...batch.selectedIds, ...batch.proposalIds])];
  const items = ids.length ? db.select().from(cleanupProposals).where(inArray(cleanupProposals.id, ids)).all() : [];
  const song = (id: number) => {
    const item = items.find((i) => i.id === id);
    return item ? { id, name: (item.evidence.name as string) ?? "", artist: (item.evidence.artist as string) ?? "", action: actionOf(item) } : { id, name: "", artist: "", action: "archive" as const };
  };
  const applied = new Set(batch.proposalIds);
  const skipped = new Set(batch.skipped.map((s) => s.id));
  const plan = batch.planId ? db.select({ title: libraryPlans.title }).from(libraryPlans).where(eq(libraryPlans.id, batch.planId)).get() : undefined;
  const byAction = (action: PlanAction) => batch.proposalIds.filter((id) => song(id).action === action).length;
  return {
    id: batch.id,
    planId: batch.planId,
    planTitle: plan?.title ?? null,
    status: batch.status,
    selected: batch.selectedIds.length || batch.proposalIds.length,
    applied: batch.proposalIds.length,
    actions: { archive: byAction("archive"), remove: byAction("remove"), save: byAction("save"), add: byAction("add"), dedupe: byAction("dedupe") },
    skipped: batch.skipped.map((s) => ({ ...song(s.id), reason: s.reason })),
    notApplied: batch.status === "running" ? [] : batch.selectedIds.filter((id) => !applied.has(id) && !skipped.has(id)).map(song),
    error: batch.error,
    calls: batch.calls,
    canUndo: batch.undo.length > 0 && batch.undoneAt === null && batch.status !== "running" && batch.undoStatus !== "running",
    undo: { status: batch.undoStatus, error: batch.undoError, undoneAt: batch.undoneAt ? new Date(batch.undoneAt).toISOString() : null },
    appliedAt: new Date(batch.appliedAt).toISOString(),
    finishedAt: batch.finishedAt ? new Date(batch.finishedAt).toISOString() : null,
  };
}

export function getBatch(db: Db, id: number) {
  const batch = db.select().from(cleanupBatches).where(eq(cleanupBatches.id, id)).get();
  if (!batch) throw new BatchNotFoundError();
  return batchView(db, batch);
}

export function listBatches(db: Db, limit: number) {
  return db.select().from(cleanupBatches).orderBy(desc(cleanupBatches.id)).limit(limit).all().map((b) => batchView(db, b));
}
