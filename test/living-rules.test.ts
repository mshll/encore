import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { createSession } from "../src/auth/sessions";
import { blocks, livingPlaylists, livingRefreshes, picks, savedTracks, spotifyAuth } from "../src/db/schema";
import { appOwnedPlaylistIds } from "../src/library/owned";
import { buildRule } from "../src/living/engine";
import { LIVING } from "../src/living/kinds";
import { createRulePlaylist, deleteRulePlaylist, previewRule, setLivingFrozen, updateRulePlaylist } from "../src/living/manage";
import { findLivingRow, refreshLiving, refreshPicksPlaylist, runLiving, setLivingEnabled, type LivingDeps } from "../src/living/refresh";
import { ruleSchema } from "../src/living/rules";
import { isDue, nextRefreshDay, periodOf } from "../src/living/schedule";
import { livingList } from "../src/living/view";
import { songKey } from "../src/plays/song";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { jsonResponse, noContent, play, routeFetch, seed, testApp, testConfig, testDb, testSettings, track, TZ, uri } from "./helpers";

const NOW = Date.parse("2026-11-14T09:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const listens = (id: string, n: number, daysAgo: number) => Array.from({ length: n }, (_, i) => play(at(daysAgo + i * 0.01), uri(id), 200_000));
const names = (items: { name: string }[]) => items.map((i) => i.name);
const rule = (input: z.input<typeof ruleSchema>) => ruleSchema.parse(input);
const allHistory = { type: "history", window: { type: "all" } } as const;

function setup(opts: { now?: () => number } = {}) {
  const db = testDb();
  const config = testConfig();
  const settings = testSettings(db, config);
  db.insert(spotifyAuth)
    .values({ id: 1, accessToken: "tok", refreshToken: "ref", expiresAt: 9e15, scope: "playlist-modify-private ugc-image-upload", spotifyUserId: "owner", clientId: "test-client", updatedAt: 0 })
    .run();
  let created = 0;
  const { fn, calls } = routeFetch((call) => {
    if (call.method === "POST" && call.url.endsWith("/me/playlists")) {
      created++;
      return jsonResponse({ id: `pl${created}`, external_urls: { spotify: `https://open.spotify.com/playlist/pl${created}` } }, 201);
    }
    if (call.method === "PUT" && call.url.includes("/playlists/")) return call.url.endsWith("/items") ? jsonResponse({ snapshot_id: "s" }) : noContent();
    return undefined;
  });
  const now = opts.now ?? (() => NOW);
  const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, settings, fn, now), settings, fn, now);
  const deps: LivingDeps = { db, spotify, settings, now };
  const sent = () => calls.map((c) => `${c.method} ${new URL(c.url).pathname.replace("/v1", "")}`);
  return { db, deps, calls, sent };
}

/** Three artists with listens of different counts and ages. */
function library(db: LivingDeps["db"]) {
  seed(
    db,
    [track("a", "A", "X", null, { releaseDate: "2019-05-01" }), track("b", "B", "X", null, { releaseDate: "2024-01-01" }), track("c", "C", "Y", null, { releaseDate: "2024-03-01" }), track("d", "D", "Z", null)],
    [...listens("a", 6, 200), ...listens("b", 4, 2), ...listens("c", 3, 30), ...listens("d", 1, 1)],
  );
}

describe("rules", () => {
  const ctx = { now: NOW, timezone: TZ };

  test("a history rule over an empty history picks nothing", () => {
    const { db } = setup();

    expect(buildRule(db, rule({ source: allHistory, schedule: "daily" }), ctx)).toEqual([]);
  });

  test("filters on listens, artists and release years combine", () => {
    const { db } = setup();
    library(db);

    const built = buildRule(db, rule({ source: allHistory, filters: { listens: { min: 2, max: 5 }, artists: { exclude: ["y"] }, releaseYears: { min: 2020 } }, sort: "listens", schedule: "daily" }), ctx);

    expect(names(built)).toEqual(["B"]);
  });

  test("last played after a number of days keeps recent songs only", () => {
    const { db } = setup();
    library(db);

    const built = buildRule(db, rule({ source: allHistory, filters: { lastPlayed: { after: { daysAgo: 7 } } }, sort: "recent", schedule: "daily" }), ctx);

    expect(names(built)).toEqual(["D", "B"]);
  });

  test("first played sorts by discovery, oldest first", () => {
    const { db } = setup();
    library(db);

    expect(names(buildRule(db, rule({ source: allHistory, sort: "first-played", schedule: "daily" }), ctx))).toEqual(["A", "C", "B", "D"]);
  });

  test("at most N per artist", () => {
    const { db } = setup();
    library(db);

    expect(names(buildRule(db, rule({ source: allHistory, sort: "listens", perArtist: 1, schedule: "daily" }), ctx))).toEqual(["A", "C", "D"]);
  });

  test("keepers drop songs mostly skipped, and a song with no known outcome passes", () => {
    const { db } = setup();
    seed(
      db,
      [track("k", "Keeper", "X", null), track("s", "Skipped", "X", null), track("u", "Unknown", "X", null)],
      [...listens("k", 3, 1), ...Array.from({ length: 3 }, (_, i) => play(at(1 + i * 0.01), uri("s"), 5_000, { skipped: true })), play(at(1), uri("s"), 200_000), play(at(1), uri("u"), null)],
    );

    const built = buildRule(db, rule({ source: allHistory, filters: { keepers: { minPlayedThrough: 0.5 } }, sort: "listens", schedule: "daily" }), ctx);

    expect(names(built)).toEqual(["Keeper", "Unknown"]);
  });

  test("a seeded shuffle is the same for the same seed", () => {
    const { db } = setup();
    library(db);
    const shuffle = rule({ source: allHistory, sort: "shuffle", schedule: "daily" });

    const once = names(buildRule(db, shuffle, { ...ctx, seed: "x:2026-11-14" }));

    expect([once, [...once].sort()]).toEqual([names(buildRule(db, shuffle, { ...ctx, seed: "x:2026-11-14" })), ["A", "B", "C", "D"]]);
  });

  test("blocked songs and artists never pass, built-ins included", () => {
    const { db } = setup();
    library(db);
    db.insert(blocks).values({ kind: "artist", key: "x", label: "X", reason: "r", createdAt: 0 }).run();
    db.insert(blocks).values({ kind: "song", key: songKey("D", "Z"), label: "D", reason: "r", createdAt: 0 }).run();

    expect([names(buildRule(db, rule({ source: allHistory, schedule: "daily" }), ctx)), names(buildRule(db, LIVING["most-played"].rule, ctx))]).toEqual([["C"], []]);
  });

  test("a moment takes plays on those weekdays within those local hours", () => {
    const { db } = setup();
    seed(db, [track("f", "Friday night", "X", null), track("m", "Monday morning", "X", null)], [play("2026-11-13T18:30:00Z", uri("f"), 200_000), play("2026-11-09T06:00:00Z", uri("m"), 200_000)]);

    expect(names(buildRule(db, rule({ source: { type: "moment", weekdays: [5], hours: { from: 20, to: 24 } }, schedule: "weekly" }), ctx))).toEqual(["Friday night"]);
  });

  test("liked songs come newest saved first", () => {
    const { db } = setup();
    library(db);
    db.insert(savedTracks).values({ uri: uri("a"), addedAt: 2, syncedAt: 0 }).run();
    db.insert(savedTracks).values({ uri: uri("c"), addedAt: 5, syncedAt: 0 }).run();

    expect(names(buildRule(db, rule({ source: { type: "liked" }, schedule: "weekly" }), ctx))).toEqual(["C", "A"]);
  });

  test("a play late in a UTC day counts on the owner's local day", () => {
    const { db } = setup();
    seed(db, [track("l", "Late", "X", null)], [play("2026-11-13T22:00:00Z", uri("l"), 200_000)]);

    expect(names(buildRule(db, rule({ source: { type: "history", window: { type: "days", days: 1 } }, schedule: "daily" }), ctx))).toEqual(["Late"]);
  });

  test("an owner's rule cannot follow the clock window or use an unknown field", () => {
    const results = [
      ruleSchema.safeParse({ source: allHistory, schedule: "window" }).success,
      ruleSchema.safeParse({ source: { type: "moment", weekdays: [1], hours: { from: 9, to: 9 } }, schedule: "daily" }).success,
      ruleSchema.safeParse({ source: allHistory, schedule: "daily", extra: 1 }).success,
    ];

    expect(results).toEqual([false, false, false]);
  });
});

describe("rule playlists", () => {
  const input = { name: "Old X", rule: rule({ source: allHistory, filters: { artists: { include: ["X"] } }, sort: "listens", schedule: "weekly" }) };

  test("a preview returns the songs without saving anything or calling Spotify", () => {
    const { db, deps, calls } = setup();
    library(db);

    const preview = previewRule(deps, input.rule);

    expect([names(preview.songs), db.select().from(livingPlaylists).all().length, calls.length]).toEqual([["A", "B"], 0, 0]);
  });

  test("a rule matching nothing previews empty and makes no playlist when switched on", async () => {
    const { db, deps, sent } = setup();
    library(db);
    const id = createRulePlaylist(db, { name: "Nobody", rule: rule({ source: allHistory, filters: { artists: { include: ["Nobody"] } }, schedule: "daily" }) }, NOW);

    const outcome = await setLivingEnabled(deps, id, true);

    expect([previewRule(deps, findLivingRow(db, id, NOW)!.rule!).count, outcome.status, sent()]).toEqual([0, "empty", []]);
  });

  test("a new rule is listed after the built-ins, off", () => {
    const { db, deps } = setup();

    const id = createRulePlaylist(db, input, NOW);

    expect(livingList(deps).items.map((i) => [i.kind, i.enabled]).at(-1)).toEqual([id, false]);
  });

  test("switching a rule on makes its private playlist with its own cover, and records the change", async () => {
    const { db, deps, sent, calls } = setup();
    library(db);
    const id = createRulePlaylist(db, input, NOW);

    await setLivingEnabled(deps, id, true);

    const history = db.select().from(livingRefreshes).all();
    expect([sent(), calls[0]!.body, history.map((h) => [h.kind, names(h.added)])]).toEqual([
      ["POST /me/playlists", "PUT /playlists/pl1/items", "PUT /playlists/pl1/images"],
      { name: "Old X", description: "Built from your rules. Updated 14 Nov 2026 by encore.", public: false },
      [[id, ["A", "B"]]],
    ]);
  });

  test("renaming a rule that is in Spotify writes the new name even when the songs stay the same", async () => {
    const { db, deps, sent } = setup();
    library(db);
    const id = createRulePlaylist(db, input, NOW);
    await setLivingEnabled(deps, id, true);

    const outcome = await updateRulePlaylist(deps, id, { ...input, name: "Old X songs" });

    expect([outcome?.status, sent().slice(3)]).toEqual(["unchanged", ["PUT /playlists/pl1", "PUT /playlists/pl1/images"]]);
  });

  test("deleting a rule forgets it and its changes, keeps the Spotify playlist and makes no call", async () => {
    const { db, deps, sent } = setup();
    library(db);
    const id = createRulePlaylist(db, input, NOW);
    await setLivingEnabled(deps, id, true);

    const kept = deleteRulePlaylist(db, id, NOW);

    expect([kept, findLivingRow(db, id, NOW), db.select().from(livingRefreshes).all().length, sent().length, appOwnedPlaylistIds(db).includes("pl1")]).toEqual([
      { id: "pl1", url: "https://open.spotify.com/playlist/pl1" },
      null,
      0,
      3,
      false,
    ]);
  });

  test("a built-in cannot be deleted", () => {
    const { db } = setup();

    expect(() => deleteRulePlaylist(db, "forgotten", NOW)).toThrow("built in");
  });
});

describe("freeze", () => {
  test("a frozen playlist is skipped by the schedule, and Refresh now still fills it", async () => {
    let clock = NOW;
    const { db, deps, sent } = setup({ now: () => clock });
    library(db);
    await setLivingEnabled(deps, "most-played", true);
    setLivingFrozen(db, "most-played", true, NOW);
    seed(db, [], listens("c", 5, 0));
    clock = NOW + DAY;

    const scheduled = await runLiving(deps);
    const manual = await refreshLiving(deps, "most-played", "manual");

    expect([scheduled.due, manual.status, sent().length]).toEqual([0, "refreshed", 5]);
  });

  test("a frozen Weekly picks does not follow a picks change", async () => {
    const { db, deps } = setup();
    db.insert(picks).values({ week: "2026-11-09", position: 1, uri: uri("p"), songKey: "p", name: "p", artist: "P", reason: "r", distance: "near", stateAt: 0, createdAt: 0 }).run();
    await setLivingEnabled(deps, "picks", true);
    setLivingFrozen(db, "picks", true, NOW);

    expect(await refreshPicksPlaylist(deps)).toBeNull();
  });
});

describe("schedule boundaries in the owner's time zone", () => {
  test("a week turns at local Monday midnight, not UTC", () => {
    const sundayNight = Date.parse("2026-11-15T20:59:00Z");
    const mondayStart = Date.parse("2026-11-15T21:00:00Z");

    expect([periodOf("weekly", sundayNight, TZ), periodOf("weekly", mondayStart, TZ)]).toEqual(["2026-11-09", "2026-11-16"]);
  });

  test("the clock window turns every three local hours, and the last one of the day leads to the next day", () => {
    const beforeNoon = Date.parse("2026-11-14T08:59:00Z");
    const noon = Date.parse("2026-11-14T09:00:00Z");
    const lateEvening = Date.parse("2026-11-14T19:30:00Z");

    expect([periodOf("window", beforeNoon, TZ), periodOf("window", noon, TZ), nextRefreshDay("window", lateEvening, lateEvening, TZ)]).toEqual(["2026-11-14:9", "2026-11-14:12", "2026-11-15"]);
  });

  test("a frozen row is never due", () => {
    const { db } = setup();
    const id = createRulePlaylist(db, { name: "R", rule: rule({ source: allHistory, schedule: "daily" }) }, NOW);
    db.update(livingPlaylists).set({ enabled: true, playlistId: "pl", checkedAt: NOW - 2 * DAY, frozen: true }).run();

    expect(isDue("daily", findLivingRow(db, id, NOW)!, NOW, TZ)).toBe(false);
  });
});

describe("HTTP", () => {
  const headers = (cookie: string) => ({ cookie, "content-type": "application/json", origin: "http://localhost:8888" });
  const body = { name: "Mine", rule: { source: { type: "liked" }, schedule: "weekly" } };

  test("creates a rule playlist and serves it with its rule and cover", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const created = (await (await app.request("/api/living", { method: "POST", headers: headers(cookie), body: JSON.stringify(body) })).json()) as { playlist: { kind: string; builtin: boolean; frozen: boolean; rule: { limit: number }; coverUrl: string } };
    const cover = await app.request(created.playlist.coverUrl, { headers: { cookie } });

    expect([created.playlist.builtin, created.playlist.frozen, created.playlist.rule.limit, cover.status]).toEqual([false, false, 50, 200]);
  });

  test("an invalid rule is a 400", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const res = await app.request("/api/living", { method: "POST", headers: headers(cookie), body: JSON.stringify({ ...body, rule: { source: { type: "liked" }, schedule: "hourly" } }) });

    expect(res.status).toBe(400);
  });

  test("previewing answers the songs", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const res = await app.request("/api/living/preview", { method: "POST", headers: headers(cookie), body: JSON.stringify({ rule: body.rule }) });

    expect(await res.json()).toEqual({ count: 0, songs: [] });
  });

  test("changing a built-in's rule is a 409, an unknown playlist a 404", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const builtin = await app.request("/api/living/forgotten", { method: "PUT", headers: headers(cookie), body: JSON.stringify(body) });
    const unknown = await app.request("/api/living/rule-0000000000", { method: "DELETE", headers: headers(cookie) });

    expect([builtin.status, unknown.status]).toEqual([409, 404]);
  });

  test("freezing answers no outcome and the playlist frozen", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const res = (await (await app.request("/api/living/forgotten", { method: "PATCH", headers: headers(cookie), body: JSON.stringify({ frozen: true }) })).json()) as { outcome: null; playlist: { frozen: boolean } };

    expect([res.outcome, res.playlist.frozen]).toEqual([null, true]);
  });
});

describe("Right now", () => {
  /** NOW is Saturday 12:00 in Kuwait: the window is Saturdays 12:00 to 15:00. */
  function saturdays(db: LivingDeps["db"]) {
    const saturdayAt = (week: number, utcHour: number) => new Date(Date.parse("2026-11-07T00:00:00Z") - week * 7 * DAY + utcHour * 3_600_000).toISOString();
    seed(
      db,
      [track("k", "Keeper", "X", null), track("o", "Often", "Y", null), track("e", "Earlier", "Z", null), track("f", "Friday", "W", null)],
      [
        play(saturdayAt(0, 10), uri("k"), 200_000),
        play(saturdayAt(1, 10), uri("k"), 200_000),
        ...[0, 1, 2].map((w) => play(saturdayAt(w, 11), uri("o"), 90_000, { reasonEnd: "endplay" })),
        ...[0, 1, 2].map((w) => play(saturdayAt(w, 6), uri("e"), 200_000)),
        ...[0, 1, 2].map((w) => play(new Date(Date.parse(saturdayAt(w, 10)) - DAY).toISOString(), uri("f"), 200_000)),
      ],
    );
  }

  test("holds the songs played at this weekday and hour, played-through songs first", () => {
    const { db } = setup();
    saturdays(db);

    expect(names(buildRule(db, LIVING["right-now"].rule, { now: NOW, timezone: TZ }))).toEqual(["Keeper", "Often"]);
  });

  test("says which window it holds", () => {
    expect(LIVING["right-now"].about({ now: NOW, timezone: TZ })).toBe("What you play on Saturdays from 12:00 to 15:00");
  });

  test("is due again when the three-hour window changes, not before", async () => {
    let clock = NOW;
    const { db, deps } = setup({ now: () => clock });
    saturdays(db);
    await setLivingEnabled(deps, "right-now", true);
    const row = () => findLivingRow(db, "right-now", clock)!;

    const due = [NOW + 2.9 * 3_600_000, NOW + 3 * 3_600_000].map((t) => isDue("window", row(), t, TZ));

    expect(due).toEqual([false, true]);
  });

  test("writes nothing to Spotify while it is not kept there", async () => {
    const { db, deps, calls } = setup();
    saturdays(db);

    await runLiving(deps);

    expect(calls).toHaveLength(0);
  });
});
