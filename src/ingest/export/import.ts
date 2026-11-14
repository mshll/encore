import { and, between, eq, inArray, max } from "drizzle-orm";
import type { Db } from "../../db/client";
import { plays } from "../../db/schema";
import { setJobState } from "../../jobs/state";
import { insertPlays, upsertTracks, type PlayInput, type TrackInput } from "../../plays/store";
import { exportFileKind, parseExportFile } from "./parse";

export type ExportFile = { name: string; content: string };

export type ImportResult = {
  files: { name: string; kind: "audio" | "video"; rows: number; invalid: number }[];
  ignoredFiles: string[];
  rowsParsed: number;
  invalidRows: number;
  inserted: number;
  alreadyPresent: number;
  apiPlaysRemoved: number;
  range: { from: string; to: string } | null;
};

export class EmptyImportError extends Error {}

const EXPORT_TS_PRECISION_MS = 999;

export function exportCoveredUntil(db: Db): number | null {
  const latest = db.select({ ts: max(plays.ts) }).from(plays).where(eq(plays.source, "export")).get()?.ts;
  return latest == null ? null : latest + EXPORT_TS_PRECISION_MS;
}

function hash(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex").slice(0, 32);
}

export function importExport(db: Db, input: ExportFile[], timezone: string, now = Date.now()): ImportResult {
  const ignoredFiles = input.filter((f) => !exportFileKind(f.name)).map((f) => f.name);
  const parsedFiles = input.filter((f) => exportFileKind(f.name)).map((f) => ({ name: f.name, ...parseExportFile(f.name, f.content) }));
  if (parsedFiles.length === 0) throw new EmptyImportError("No Streaming_History_Audio_*.json or Streaming_History_Video_*.json files found");

  const occurrences = new Map<string, number>();
  const playRows: PlayInput[] = [];
  const trackRows: TrackInput[] = [];
  for (const file of parsedFiles) {
    for (const entry of file.entries) {
      const digest = hash(entry.identity);
      const n = (occurrences.get(digest) ?? 0) + 1;
      occurrences.set(digest, n);
      playRows.push({ ...entry.play, dedupeKey: `export:${digest}:${n}` });
      if (entry.track) trackRows.push(entry.track);
    }
  }

  const range = playRows.reduce<{ from: number; to: number } | null>(
    (r, p) => (r ? { from: Math.min(r.from, p.ts), to: Math.max(r.to, p.ts) } : { from: p.ts, to: p.ts }),
    null,
  );

  const { inserted, apiPlaysRemoved } = db.transaction((tx) => {
    const removed = range
      ? tx
          .delete(plays)
          .where(and(inArray(plays.source, ["api", "live"]), between(plays.ts, range.from, range.to + EXPORT_TS_PRECISION_MS)))
          .returning({ id: plays.id })
          .all().length
      : 0;
    upsertTracks(tx, trackRows, now);
    return { inserted: insertPlays(tx, playRows, timezone), apiPlaysRemoved: removed };
  });

  const result: ImportResult = {
    files: parsedFiles.map((f) => ({ name: f.name, kind: f.kind, rows: f.entries.length, invalid: f.invalid })),
    ignoredFiles,
    rowsParsed: playRows.length,
    invalidRows: parsedFiles.reduce((sum, f) => sum + f.invalid, 0),
    inserted,
    alreadyPresent: playRows.length - inserted,
    apiPlaysRemoved,
    range: range && { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() },
  };
  setJobState(db, "import", { lastRunAt: now, lastSuccessAt: now, lastError: null, data: result });
  return result;
}
