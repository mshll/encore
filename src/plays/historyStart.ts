import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { lt, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { plays } from "../db/schema";
import { SettingsValidationError, type SettingsStore } from "../settings/store";

export type PlaysBefore = { plays: number; firstDay: string | null; lastDay: string | null; hours: number };

export type HistoryStartResult = { historyStart: string; removed: PlaysBefore; snapshot: string | null };

export type HistoryStartDeps = { db: Db; settings: SettingsStore; backupDir: string; now: () => number };

export class SnapshotError extends Error {}

export const backupDirFor = (databasePath: string) => join(dirname(databasePath), "backups");

/** Every stored play, of any kind, on a local day before `day`. */
export function playsBefore(db: DbOrTx, day: string): PlaysBefore {
  const row = db.all<{ plays: number; first_day: string | null; last_day: string | null; ms: number | null }>(
    sql`select count(*) as plays, min(day) as first_day, max(day) as last_day, sum(ms_played) as ms from plays where day < ${day}`,
  )[0]!;
  return { plays: row.plays, firstDay: row.first_day, lastDay: row.last_day, hours: Math.round((row.ms ?? 0) / 36_000) / 100 };
}

function snapshot(db: Db, dir: string, at: number): string {
  const name = `encore-${new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-")}.db`;
  try {
    mkdirSync(dir, { recursive: true });
    db.run(sql`vacuum into ${join(dir, name)}`);
  } catch (error) {
    throw new SnapshotError(error instanceof Error ? error.message : String(error));
  }
  return name;
}

/**
 * Saves the history start and deletes the plays before it, after a snapshot of the database. Nothing else is
 * touched: tracks, artists and tags stay. An env-set start can be applied but not changed.
 */
export function applyHistoryStart({ db, settings, backupDir, now }: HistoryStartDeps, day: string): HistoryStartResult {
  const entry = settings.entry("historyStart")!;
  const envSet = entry.source === "env";
  if (envSet && entry.value !== day)
    throw new SettingsValidationError([{ key: "historyStart", reason: "locked", message: `Set by the ${entry.field.env} environment variable; change it there` }]);
  if (!envSet) settings.validate({ historyStart: day });

  const pending = playsBefore(db, day);
  const file = pending.plays > 0 ? snapshot(db, backupDir, now()) : null;
  if (!envSet) settings.update({ historyStart: day });
  const removed = db.transaction((tx) => {
    const before = playsBefore(tx, day);
    tx.delete(plays).where(lt(plays.day, day)).run();
    return before;
  });
  return { historyStart: day, removed, snapshot: file };
}
