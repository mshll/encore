import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createSession } from "../src/auth/sessions";
import { trackTags } from "../src/db/schema";
import { loadCatalog } from "../src/library/catalog";
import { localTime } from "../src/plays/localTime";
import { insertPlays } from "../src/plays/store";
import type { SettingFieldView, SettingsView } from "../src/settings/view";
import { play, seed, testApp, testDb, track, TZ, uri, WEEKEND } from "./helpers";

const A = uri("a");
const B = uri("b");
const LAST_BEFORE = "2023-12-31T20:59:59.999Z";
const MIDNIGHT = "2023-12-31T21:00:00.000Z";

function signedIn(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "encore-history-"));
  const app = testApp({ DATABASE_PATH: join(dir, "encore.db"), ...env });
  const cookie = `encore_session=${createSession(app.db)}`;
  const get = (path: string) => app.app.request(path, { headers: { cookie } });
  const send = (method: string, path: string, json: unknown) =>
    app.app.request(path, { method, body: JSON.stringify(json), headers: { cookie, "content-type": "application/json" } });
  const apply = (historyStart: string) => send("POST", "/api/settings/history-start", { historyStart });
  const days = () => app.db.all<{ day: string }>(sql`select day from plays order by ts`).map((r) => r.day);
  seed(
    app.db,
    [track("a", "Song A", "Artist", "Album"), track("b", "Song B", "Artist", "Album")],
    [play("2021-05-16T10:00:00Z", B, 3_600_000), play(LAST_BEFORE, A, 1_800_000), play(MIDNIGHT, A, 200_000), play("2026-01-05T10:00:00Z", A, 200_000)],
  );
  return { ...app, dir, backups: join(dir, "backups"), get, send, apply, days };
}

const historyStart = (view: SettingsView): SettingFieldView => view.groups.flatMap((g) => g.fields).find((f) => f.key === "historyStart")!;

describe("history start cutoff", () => {
  test("a play at local midnight of the start day is kept and the one before it is dropped", () => {
    const db = testDb();
    seed(db, [track("a", "Song A", "Artist", "Album")], []);

    insertPlays(db, [play(LAST_BEFORE, A, 1000), play(MIDNIGHT, A, 1000)], { timezone: TZ, historyStart: "2024-01-01" });

    expect(db.all(sql`select ts, day from plays`)).toEqual([{ ts: Date.parse(MIDNIGHT), day: "2024-01-01" }]);
  });
});

describe("GET /api/settings/history-start", () => {
  test("counts what a date would remove without removing it", async () => {
    const { get, days } = signedIn();

    const res = await get("/api/settings/history-start?before=2024-01-01");

    expect(await res.json()).toEqual({ plays: 2, firstDay: "2021-05-16", lastDay: "2023-12-31", hours: 1.5 });
    expect(days()).toHaveLength(4);
  });

  test("rejects a malformed date", async () => {
    const { get } = signedIn();

    expect((await get("/api/settings/history-start?before=2024-1-1")).status).toBe(400);
  });
});

describe("POST /api/settings/history-start", () => {
  test("snapshots the database, saves the setting and deletes the earlier plays", async () => {
    const { apply, days, backups } = signedIn();

    const res = await apply("2024-01-01");

    const body = (await res.json()) as SettingsView & { removed: unknown; snapshot: string };
    expect(body.removed).toEqual({ plays: 2, firstDay: "2021-05-16", lastDay: "2023-12-31", hours: 1.5 });
    expect(historyStart(body)).toMatchObject({ value: "2024-01-01", source: "db" });
    expect(days()).toEqual(["2024-01-01", "2026-01-05"]);
    expect(new Database(join(backups, body.snapshot)).query("select count(*) as n from plays").get()).toEqual({ n: 4 });
  });

  test("keeps tracks, artists and tags", async () => {
    const { apply, db } = signedIn();
    db.insert(trackTags)
      .values({ songKey: "song b", trackUri: B, genres: ["pop"], moods: [], energy: 3, valence: 3, language: "en", model: "m", confidence: "high", taggedAt: 1 })
      .run();
    const counts = () => db.all(sql`select (select count(*) from tracks) as tracks, (select count(*) from artists) as artists, (select count(*) from track_tags) as tags`);
    const before = counts();

    await apply("2024-01-01");

    expect(counts()).toEqual(before);
  });

  test("the cached song catalog forgets songs whose only plays were removed", async () => {
    const { apply, db } = signedIn();
    const names = () => [...loadCatalog(db, WEEKEND).songs.values()].map((s) => s.name);
    expect(names()).toContain("Song B");

    await apply("2024-01-01");

    expect(names()).toEqual(["Song A"]);
  });

  test("a failed snapshot deletes nothing and saves nothing", async () => {
    const { apply, days, dir, settings } = signedIn();
    writeFileSync(join(dir, "backups"), "");

    const res = await apply("2024-01-01");

    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("snapshot_failed");
    expect(days()).toHaveLength(4);
    expect(settings.get().historyStart).toBeUndefined();
  });

  test("a second run removes nothing and writes no snapshot", async () => {
    const { apply, backups } = signedIn();
    await apply("2024-01-01");

    const res = await apply("2024-01-01");

    expect(await res.json()).toMatchObject({ removed: { plays: 0, firstDay: null, lastDay: null, hours: 0 }, snapshot: null });
    expect(readdirSync(backups)).toHaveLength(1);
  });

  test("with nothing before the date it still saves the setting", async () => {
    const { apply, backups, settings } = signedIn();

    await apply("2021-01-01");

    expect(settings.get().historyStart).toBe("2021-01-01");
    expect(existsSync(backups)).toBe(false);
  });

  test("rejects a date in the future and an impossible date", async () => {
    const { apply, days } = signedIn();

    const statuses = [(await apply("2999-01-01")).status, (await apply("2024-02-30")).status];

    expect(statuses).toEqual([400, 400]);
    expect(days()).toHaveLength(4);
  });

  test("an env-set start can be applied but not changed", async () => {
    const { apply, days } = signedIn({ HISTORY_START: "2024-01-01" });

    const other = await apply("2025-01-01");
    const same = await apply("2024-01-01");

    expect(other.status).toBe(400);
    expect(same.status).toBe(200);
    expect(days()).toEqual(["2024-01-01", "2026-01-05"]);
  });
});

describe("PATCH /api/settings historyStart", () => {
  test("saves the date without deleting plays", async () => {
    const { send, days } = signedIn();

    const res = await send("PATCH", "/api/settings", { historyStart: "2024-01-01" });

    expect(res.status).toBe(200);
    expect(days()).toHaveLength(4);
  });

  test("rejects a day that has begun somewhere on Earth but not yet in the configured time zone", async () => {
    const { send } = signedIn({ TIMEZONE: "Pacific/Pago_Pago" });

    const res = await send("PATCH", "/api/settings", { historyStart: localTime(Date.now(), "Etc/GMT-14").day });

    expect(((await res.json()) as { error: { details: unknown } }).error.details).toEqual([{ key: "historyStart", reason: "invalid", message: "must not be in the future" }]);
  });
});
