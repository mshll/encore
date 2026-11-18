import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/auth/sessions";
import type { RemoteObject, RemoteStore } from "../src/backup/remote";
import { play, seed, testApp, track, uri } from "./helpers";

const S3 = { BACKUP_S3_ENDPOINT: "https://s3.example.com", BACKUP_S3_BUCKET: "encore-test", BACKUP_S3_ACCESS_KEY_ID: "AKIDEXAMPLE", BACKUP_S3_SECRET_ACCESS_KEY: "secret-0123456789" };

function memoryRemote(): RemoteStore & { objects: Map<string, RemoteObject> } {
  const objects = new Map<string, RemoteObject>();
  return {
    objects,
    upload: async (name) => void objects.set(name, { name, size: 5, at: 0 }),
    list: async () => [...objects.values()],
    remove: async (name) => void objects.delete(name),
    exists: async (name) => objects.has(name),
    stream: (name) => new Blob([`remote ${name}`]).stream(),
  };
}

function signedIn(env: Record<string, string> = {}) {
  const remote = memoryRemote();
  const dir = mkdtempSync(join(tmpdir(), "encore-ops-"));
  const app = testApp({ DATABASE_PATH: join(dir, "encore.db"), SECRETS_KEY: "k".repeat(40), ...env }, fetch, null, { remote: () => remote });
  seed(app.db, [track("a", "Song, A", "Artist", "Album")], [play("2026-01-05T10:00:00Z", uri("a"), 200_000)]);
  const cookie = `encore_session=${createSession(app.db)}`;
  const get = (path: string) => app.app.request(path, { headers: { cookie } });
  const post = (path: string) => app.app.request(path, { method: "POST", headers: { cookie } });
  return { ...app, remote, get, post };
}

describe("backups over HTTP", () => {
  test("Run now writes a backup that the list and download then serve", async () => {
    const { get, post } = signedIn();

    const run = (await (await post("/api/backups")).json()) as { backup: { file: string; size: number } };
    const list = (await (await get("/api/backups")).json()) as { local: { name: string; size: number }[]; remote: null };
    const download = await get(`/api/backups/${run.backup.file}/download`);

    expect({ listed: list.local.map((f) => f.name), remote: list.remote, status: download.status, bytes: (await download.arrayBuffer()).byteLength, disposition: download.headers.get("content-disposition") }).toEqual({
      listed: [run.backup.file],
      remote: null,
      status: 200,
      bytes: run.backup.size,
      disposition: `attachment; filename="${run.backup.file}"`,
    });
  });

  test("lists and downloads the bucket copy", async () => {
    const { get, post } = signedIn(S3);

    const { backup } = (await (await post("/api/backups")).json()) as { backup: { file: string } };
    const list = (await (await get("/api/backups")).json()) as { remote: { name: string }[] };
    const body = await (await get(`/api/backups/${backup.file}/download?from=remote`)).text();

    expect({ remote: list.remote.map((f) => f.name), body }).toEqual({ remote: [backup.file], body: `remote ${backup.file}` });
  });

  test("a name outside the backups directory is not found", async () => {
    const { get } = signedIn();

    const res = await get(`/api/backups/${encodeURIComponent("../encore.db")}/download`);

    expect(res.status).toBe(404);
  });

  test("a failed backup answers 502 and stays in job state", async () => {
    const { get, post, remote } = signedIn(S3);
    remote.upload = () => Promise.reject(new Error("bucket gone"));

    const res = await post("/api/backups");
    const list = (await (await get("/api/backups")).json()) as { job: { lastError: string } };

    expect({ status: res.status, lastError: list.job.lastError }).toEqual({ status: 502, lastError: expect.stringContaining("bucket gone") });
  });
});

describe("plays export over HTTP", () => {
  test("CSV downloads as an attachment", async () => {
    const { get } = signedIn();

    const res = await get("/api/export/plays?format=csv");

    expect({ type: res.headers.get("content-type"), disposition: res.headers.get("content-disposition"), rows: (await res.text()).trim().split("\r\n").length }).toEqual({
      type: "text/csv; charset=utf-8",
      disposition: expect.stringMatching(/^attachment; filename="encore-plays-\d{4}-\d{2}-\d{2}\.csv"$/),
      rows: 2,
    });
  });

  test("needs a session", async () => {
    const { request } = testApp();

    expect((await request("/api/export/plays")).status).toBe(401);
  });
});

describe("alerts over HTTP", () => {
  test("Send test with no channel is refused", async () => {
    const { post } = signedIn();

    const res = await post("/api/alerts/test");

    expect(res.status).toBe(409);
  });
});
