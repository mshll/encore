import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

/** Scheduled backups start with this; other snapshots (before a history-start delete) start with `encore-` only. */
export const BACKUP_PREFIX = "encore-backup-";

const stamp = (at: number) => new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");

export const snapshotName = (at: number, prefix = "encore-") => `${prefix}${stamp(at)}.db`;

/** Only names encore writes pass, so a name from a request can never reach outside the backups directory. */
export const isSnapshotName = (name: string) => /^encore-[A-Za-z0-9-]+\.db$/.test(name);

/** A consistent copy of the whole database, written while the app keeps running. */
export function writeSnapshot(db: Db, dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  db.run(sql`vacuum into ${path}`);
  return path;
}
