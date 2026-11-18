import { and, between, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client";
import { plays, playTombstones, playTrash } from "../../db/schema";
import { setJobState } from "../../jobs/state";
import { localTime } from "../../plays/localTime";
import { MATCH_AFTER_MS, MATCH_BEFORE_MS } from "../../plays/match";
import { beforeHistoryStart, insertPlays, upsertTracks, type HistoryWindow, type PlayInput, type TrackInput } from "../../plays/store";
import { tombstonedKeys } from "../../plays/trash";
import { exportFileKind, parseExportFile } from "./parse";

export type ExportFile = { name: string; content: string };

export type ImportResult = {
  files: { name: string; kind: "audio" | "video"; rows: number; invalid: number }[];
  ignoredFiles: string[];
  rowsParsed: number;
  invalidRows: number;
  inserted: number;
  alreadyPresent: number;
  deleted: number;
  beforeHistoryStart: number;
  apiPlaysRemoved: number;
  range: { from: string; to: string } | null;
};

export class EmptyImportError extends Error {}

const EXPORT_TS_PRECISION_MS = 999;

export function exportCoveredUntil(db: DbOrTx): number | null {
  const latest = db.all<{ ts: number | null }>(sql`
    select max(ts) as ts from (select max(ts) as ts from plays where source = 'export' union all select max(ts) from play_tombstones where source = 'export')`)[0]?.ts;
  return latest == null ? null : latest + EXPORT_TS_PRECISION_MS;
}

function hash(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex").slice(0, 32);
}

type Range = { from: number; to: number };

const DAY_MS = 86_400_000;

type Tombstone = { dedupe_key: string; source: string; track_uri: string; ts: number; ms_played: number | null; duration_ms: number | null; deleted_at: number };

/**
 * A live or export ts is the end of the listen. An api ts is Spotify's played_at, which may fall anywhere from
 * the start of the listen to just after its end (the same window live reconcile uses), so the listen can end
 * up to the track's length after it.
 */
function endsWithin(t: Tombstone, end: number): boolean {
  if (t.source !== "api") return end >= t.ts - (t.ms_played ?? 0) - MATCH_BEFORE_MS && end <= t.ts + MATCH_AFTER_MS;
  return end >= t.ts - MATCH_AFTER_MS && end <= t.ts + Math.max((t.duration_ms ?? 0) + MATCH_BEFORE_MS, MATCH_AFTER_MS);
}

/**
 * An export row is the same listen as a deleted api or live play of its track when it ends inside that play's
 * match window; each deleted play takes the nearest such row, and each row matches once. The export row takes
 * the deleted play's place, in the trash too, so the deletion holds and Restore brings back the export row. Returns the rows still to insert and how many match a deleted play.
 */
function keepDeleted(tx: DbOrTx, rows: PlayInput[], timezone: string): { rows: PlayInput[]; deleted: number } {
  const tombstoned = tombstonedKeys(
    tx,
    rows.map((r) => r.dedupeKey),
  );
  const stored = storedKeys(
    tx,
    rows.map((r) => r.dedupeKey),
  );
  const candidates = rows.filter((r) => r.trackUri && !tombstoned.has(r.dedupeKey) && !stored.has(r.dedupeKey));
  const span = rangeOf(candidates.map((r) => r.ts));
  const unchanged = { rows, deleted: tombstoned.size };
  if (!span) return unchanged;
  const tombstones = tx.all<Tombstone>(sql`
    select t.dedupe_key, t.source, t.track_uri, t.ts, t.ms_played, k.duration_ms, t.deleted_at
    from play_tombstones t left join tracks k on k.uri = t.track_uri
    where t.source in ('api', 'live') and t.track_uri is not null and t.ts between ${span.from - DAY_MS} and ${span.to + DAY_MS}`);
  if (tombstones.length === 0) return unchanged;
  const pairs = candidates.flatMap((row) =>
    tombstones
      .filter((t) => t.track_uri === row.trackUri && endsWithin(t, row.ts))
      .map((t) => ({ row, t, distance: Math.abs(row.ts - t.ts) })),
  );
  pairs.sort((a, b) => a.distance - b.distance);
  const replaced = new Set<string>();
  const used = new Set<string>();
  for (const { row, t } of pairs) {
    if (replaced.has(row.dedupeKey) || used.has(t.dedupe_key)) continue;
    used.add(t.dedupe_key);
    replaced.add(row.dedupeKey);
    tx.delete(playTombstones).where(eq(playTombstones.dedupeKey, t.dedupe_key)).run();
    tx.insert(playTombstones).values({ dedupeKey: row.dedupeKey, source: row.source, trackUri: row.trackUri, ts: row.ts, msPlayed: row.msPlayed, deletedAt: t.deleted_at }).run();
    const trashed = tx.select({ id: playTrash.id, trashedAt: playTrash.trashedAt }).from(playTrash).where(eq(playTrash.dedupeKey, t.dedupe_key)).get();
    if (!trashed) continue;
    tx.delete(playTrash).where(eq(playTrash.id, trashed.id)).run();
    tx.insert(playTrash)
      .values({ ...row, ...localTime(row.ts, timezone), id: trashed.id, trashedAt: trashed.trashedAt })
      .run();
  }
  return { rows: rows.filter((r) => !replaced.has(r.dedupeKey)), deleted: tombstoned.size + replaced.size };
}

function storedKeys(tx: DbOrTx, keys: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 500)
    for (const r of tx.select({ k: plays.dedupeKey }).from(plays).where(inArray(plays.dedupeKey, keys.slice(i, i + 500))).all()) out.add(r.k);
  return out;
}

function rangeOf(timestamps: number[]): Range | null {
  return timestamps.reduce<Range | null>((r, ts) => (r ? { from: Math.min(r.from, ts), to: Math.max(r.to, ts) } : { from: ts, to: ts }), null);
}

/**
 * Export rows replace api and live plays only inside each audio file's own time range. The video file spans
 * the whole account and two uploaded files can be years apart, so one range over the upload would delete
 * plays the export does not contain.
 */
export function importExport(db: Db, input: ExportFile[], window: HistoryWindow, now = Date.now()): ImportResult {
  const ignoredFiles = input.filter((f) => !exportFileKind(f.name)).map((f) => f.name);
  const parsedFiles = input.filter((f) => exportFileKind(f.name)).map((f) => ({ name: f.name, ...parseExportFile(f.name, f.content) }));
  if (parsedFiles.length === 0) throw new EmptyImportError("No Streaming_History_Audio_*.json or Streaming_History_Video_*.json files found");

  const occurrences = new Map<string, number>();
  const playRows: PlayInput[] = [];
  const trackRows: TrackInput[] = [];
  const audioRanges: Range[] = [];
  for (const file of parsedFiles) {
    const fileRange = rangeOf(file.entries.map((e) => e.play.ts));
    if (fileRange && file.kind === "audio") audioRanges.push(fileRange);
    for (const entry of file.entries) {
      const digest = hash(entry.identity);
      const n = (occurrences.get(digest) ?? 0) + 1;
      occurrences.set(digest, n);
      playRows.push({ ...entry.play, dedupeKey: `export:${digest}:${n}` });
      if (entry.track) trackRows.push(entry.track);
    }
  }

  const kept = playRows.filter((p) => !beforeHistoryStart(p.ts, window));
  const range = rangeOf(kept.map((p) => p.ts));

  const { inserted, apiPlaysRemoved, deleted } = db.transaction((tx) => {
    const removed = audioRanges.reduce(
      (n, r) =>
        n +
        tx
          .delete(plays)
          .where(and(inArray(plays.source, ["api", "live"]), between(plays.ts, r.from, r.to + EXPORT_TS_PRECISION_MS)))
          .returning({ id: plays.id })
          .all().length,
      0,
    );
    upsertTracks(tx, trackRows, now);
    const fresh = keepDeleted(tx, kept, window.timezone);
    return { inserted: insertPlays(tx, fresh.rows, window), apiPlaysRemoved: removed, deleted: fresh.deleted };
  });

  const result: ImportResult = {
    files: parsedFiles.map((f) => ({ name: f.name, kind: f.kind, rows: f.entries.length, invalid: f.invalid })),
    ignoredFiles,
    rowsParsed: playRows.length,
    invalidRows: parsedFiles.reduce((sum, f) => sum + f.invalid, 0),
    inserted,
    alreadyPresent: kept.length - inserted - deleted,
    deleted,
    beforeHistoryStart: playRows.length - kept.length,
    apiPlaysRemoved,
    range: range && { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() },
  };
  setJobState(db, "import", { lastRunAt: now, lastSuccessAt: now, lastError: null, data: result });
  return result;
}
