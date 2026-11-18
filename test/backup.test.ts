import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beyondKeep } from "../src/backup/retention";
import type { RemoteObject, RemoteStore } from "../src/backup/remote";
import { BackupError, Backups } from "../src/backup/service";
import { isSnapshotName } from "../src/backup/snapshot";
import type { S3Settings } from "../src/settings/settings";
import { play, seed, testConfig, testDb, testSettings, track, uri } from "./helpers";

const SECRET = "secret-access-key-0123456789";
const S3 = { BACKUP_S3_ENDPOINT: "https://s3.example.com", BACKUP_S3_BUCKET: "encore-test", BACKUP_S3_ACCESS_KEY_ID: "AKIDEXAMPLE", BACKUP_S3_SECRET_ACCESS_KEY: SECRET };

class FakeRemote implements RemoteStore {
  objects = new Map<string, RemoteObject>();
  failUpload: Error | null = null;
  constructor(readonly settings?: S3Settings) {}
  async upload(name: string) {
    if (this.failUpload) throw this.failUpload;
    this.objects.set(name, { name, size: 1, at: 0 });
  }
  async list() {
    return [...this.objects.values()];
  }
  async remove(name: string) {
    this.objects.delete(name);
  }
  async exists(name: string) {
    return this.objects.has(name);
  }
  stream(name: string) {
    return new Blob([name]).stream();
  }
}

function setup(env: Record<string, string> = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), "encore-backup-")), "backups");
  const db = testDb();
  seed(db, [track("a", "Song A", "Artist", "Album")], [play("2026-01-05T10:00:00Z", uri("a"), 200_000)]);
  const settings = testSettings(db, testConfig(env));
  const remote = new FakeRemote();
  let clock = Date.parse("2026-11-01T03:00:00Z");
  const backups = new Backups({ db, dir, settings, remote: (s) => Object.assign(remote, { settings: s }), now: () => clock });
  const advance = (ms: number) => (clock += ms);
  return { db, dir, backups, remote, advance };
}

describe("retention", () => {
  test("keeps the newest scheduled backups and never touches other snapshots", () => {
    const names = ["encore-backup-2026-11-01T03-00-00Z.db", "encore-2026-01-01T00-00-00Z.db", "encore-backup-2026-11-03T03-00-00Z.db", "encore-backup-2026-11-02T03-00-00Z.db"];

    expect(beyondKeep(names, 2)).toEqual(["encore-backup-2026-11-01T03-00-00Z.db"]);
    expect(beyondKeep(names, 5)).toEqual([]);
  });

  test("snapshot names reject paths", () => {
    expect(isSnapshotName("encore-backup-2026-11-01T03-00-00Z.db")).toBe(true);
    expect(isSnapshotName("../encore.db")).toBe(false);
    expect(isSnapshotName("encore-x/../../etc.db")).toBe(false);
  });
});

describe("backup run", () => {
  test("writes a readable copy of the database", async () => {
    const { backups, dir } = setup();

    const run = await backups.run();

    expect(run.file).toBe("encore-backup-2026-11-01T03-00-00Z.db");
    expect(run.remote).toBeNull();
    const copy = new Database(join(dir, run.file), { readonly: true });
    expect(copy.query("select count(*) as n from plays").get()).toEqual({ n: 1 });
    copy.close();
  });

  test("prunes local backups past the setting and keeps other snapshots", async () => {
    const { backups, dir, advance } = setup({ BACKUP_KEEP: "2" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "encore-2025-01-01T00-00-00Z.db"), "history snapshot");

    for (let i = 0; i < 3; i++) {
      await backups.run();
      advance(86_400_000);
    }

    expect(readdirSync(dir).sort()).toEqual(["encore-2025-01-01T00-00-00Z.db", "encore-backup-2026-11-02T03-00-00Z.db", "encore-backup-2026-11-03T03-00-00Z.db"]);
    expect(backups.localFiles().map((f) => f.name)).toHaveLength(3);
  });

  test("uploads to the bucket with the same retention", async () => {
    const { backups, remote, advance } = setup({ BACKUP_KEEP: "2", ...S3 });

    for (let i = 0; i < 3; i++) {
      await backups.run();
      advance(86_400_000);
    }

    expect(remote.settings).toMatchObject({ endpoint: "https://s3.example.com", bucket: "encore-test", secretAccessKey: SECRET });
    expect([...remote.objects.keys()].sort()).toEqual(["encore-backup-2026-11-02T03-00-00Z.db", "encore-backup-2026-11-03T03-00-00Z.db"]);
    expect((await backups.remoteFiles())?.files.map((f) => f.name)).toEqual(["encore-backup-2026-11-03T03-00-00Z.db", "encore-backup-2026-11-02T03-00-00Z.db"]);
  });

  test("a failed upload fails the run without the secret in its message, after the local copy is saved", async () => {
    const { backups, remote, dir } = setup(S3);
    remote.failUpload = Object.assign(new Error(`signature mismatch for ${SECRET}`), { code: "SignatureDoesNotMatch" });

    const error = await backups.run().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BackupError);
    expect((error as Error).message).toContain("SignatureDoesNotMatch");
    expect((error as Error).message).not.toContain(SECRET);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  test("a second run while one is going is refused", async () => {
    const { backups, remote } = setup(S3);
    let release = () => {};
    remote.upload = () => new Promise<void>((resolve) => (release = resolve));

    const first = backups.run();
    await Bun.sleep(0);

    const second = await backups.run().catch((e: unknown) => e);
    release();
    await first;

    expect((second as Error).message).toBe("A backup is already running");
  });
});
