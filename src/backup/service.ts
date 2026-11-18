import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/client";
import type { Job } from "../jobs/scheduler";
import { redact } from "../settings/redact";
import type { S3Settings, SettingsSource } from "../settings/settings";
import { s3Store, type RemoteStore } from "./remote";
import { beyondKeep } from "./retention";
import { BACKUP_PREFIX, isSnapshotName, snapshotName, writeSnapshot } from "./snapshot";

export const BACKUP_JOB = "backup";

export type BackupFile = { name: string; size: number; createdAt: string | null };

export type BackupRun = { file: string; size: number; pruned: string[]; remote: { uploaded: string; pruned: string[] } | null };

export type RemoteListing = { files: BackupFile[]; error: string | null } | null;

export class BackupRunningError extends Error {
  constructor() {
    super("A backup is already running");
  }
}

export class BackupError extends Error {}

export type BackupDeps = {
  db: Db;
  dir: string;
  settings: SettingsSource;
  remote?: (settings: S3Settings) => RemoteStore;
  now?: () => number;
};

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Scheduled snapshots of the database in the backups directory, optionally copied to an S3-compatible bucket. */
export class Backups {
  private active = false;
  private readonly now: () => number;
  private readonly makeRemote: (settings: S3Settings) => RemoteStore;

  constructor(private readonly deps: BackupDeps) {
    this.now = deps.now ?? Date.now;
    this.makeRemote = deps.remote ?? s3Store;
  }

  get running(): boolean {
    return this.active;
  }

  get dir(): string {
    return this.deps.dir;
  }

  remote(): RemoteStore | null {
    const s3 = this.deps.settings.get().backup.s3;
    return s3 ? this.makeRemote(s3) : null;
  }

  /** Writes a snapshot, keeps the newest `keep` here and in the bucket. A failed upload fails the run after the local copy is saved. */
  async run(): Promise<BackupRun> {
    if (this.active) throw new BackupRunningError();
    this.active = true;
    try {
      const { keep, s3 } = this.deps.settings.get().backup;
      const name = snapshotName(this.now(), BACKUP_PREFIX);
      let path: string;
      try {
        path = writeSnapshot(this.deps.db, this.deps.dir, name);
      } catch (error) {
        throw new BackupError(`Could not write the snapshot: ${messageOf(error)}`);
      }
      const pruned = beyondKeep(this.localNames(), keep);
      for (const old of pruned) rmSync(join(this.deps.dir, old), { force: true });
      const run: BackupRun = { file: name, size: statSync(path).size, pruned, remote: null };
      const remote = this.remote();
      if (!remote) return run;
      try {
        await remote.upload(name, path);
        const remotePruned = beyondKeep(
          (await remote.list()).map((o) => o.name),
          keep,
        );
        for (const old of remotePruned) await remote.remove(old);
        return { ...run, remote: { uploaded: name, pruned: remotePruned } };
      } catch (error) {
        throw new BackupError(`Saved ${name} on the server, but the bucket copy failed: ${this.redacted(error, s3)}`);
      }
    } finally {
      this.active = false;
    }
  }

  /** Every snapshot in the backups directory, newest first, including the ones taken before a history-start delete. */
  localFiles(): BackupFile[] {
    return this.localNames()
      .map((name) => {
        const stat = statSync(join(this.deps.dir, name));
        return { name, size: stat.size, createdAt: iso(stat.mtimeMs) };
      })
      .sort((a, b) => (a.createdAt! < b.createdAt! ? 1 : -1));
  }

  async remoteFiles(): Promise<RemoteListing> {
    const remote = this.remote();
    if (!remote) return null;
    try {
      const files = (await remote.list()).map((o) => ({ name: o.name, size: o.size, createdAt: iso(o.at) }));
      return { files: files.sort((a, b) => (a.name < b.name ? 1 : -1)), error: null };
    } catch (error) {
      return { files: [], error: this.redacted(error, this.deps.settings.get().backup.s3) };
    }
  }

  localPath(name: string): string | null {
    if (!isSnapshotName(name)) return null;
    const path = join(this.deps.dir, name);
    return existsSync(path) ? path : null;
  }

  async remoteStream(name: string): Promise<ReadableStream<Uint8Array> | null> {
    const remote = this.remote();
    if (!remote || !isSnapshotName(name) || !(await remote.exists(name))) return null;
    return remote.stream(name);
  }

  job(): Job {
    return { name: BACKUP_JOB, intervalMs: () => this.deps.settings.get().backup.intervalMs, run: async () => ({ ...(await this.run()) }) };
  }

  private localNames(): string[] {
    if (!existsSync(this.deps.dir)) return [];
    return readdirSync(this.deps.dir).filter(isSnapshotName);
  }

  private redacted(error: unknown, s3: S3Settings | null): string {
    const code = error instanceof Error && "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
    return redact(`${code}${messageOf(error)}`, [s3?.accessKeyId, s3?.secretAccessKey]);
  }
}
