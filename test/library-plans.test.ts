import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { createSession } from "../src/auth/sessions";
import type { Db } from "../src/db/client";
import { appPlaylists, cleanupBatches, cleanupProposals, libraryPlans, llmThreads, ownedPlaylists, playlistItems, savedTracks, sets } from "../src/db/schema";
import { getBatch, recoverInterrupted, startApply, startUndo } from "../src/library/apply";
import { loadLibrary } from "../src/library/analysis";
import { createPlan, getPlan, planFromGroup, updateItems } from "../src/library/plans";
import { CLEANUP_RULES, computeProposals, ensureRulePlans, refreshProposals, rulePlanIds } from "../src/library/rules";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { inBackground } from "../src/spotify/pacer";
import { connectSpotify, jsonResponse, play, routeFetch, seed, testApp, testConfig, testDb, testSettings, track, TZ, uri, WEEKEND, type FetchCall } from "./helpers";

const NOW = Date.parse("2026-11-14T09:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();
const SETTINGS = { timezone: TZ, weekendDays: WEEKEND };

/** A Spotify account in memory: liked songs and playlists that the fake endpoints change the way Spotify does. */
type Account = { liked: string[]; playlists: Map<string, { snapshot: number; items: string[] }>; created: number };

function fakeSpotify(account: Account, fail: (call: FetchCall) => boolean = () => false, gate?: Promise<void>) {
  return routeFetch(async (call) => {
    if (gate) await gate;
    if (fail(call)) return jsonResponse({ error: { message: "boom" } }, 500);
    const url = new URL(call.url);
    const uris = () => (url.searchParams.get("uris") ?? "").split(",").filter(Boolean);
    if (url.pathname === "/v1/me/library" && call.method === "DELETE") {
      account.liked = account.liked.filter((u) => !uris().includes(u));
      return new Response(null, { status: 200 });
    }
    if (url.pathname === "/v1/me/library" && call.method === "PUT") {
      account.liked.push(...uris().filter((u) => !account.liked.includes(u)));
      return new Response(null, { status: 200 });
    }
    if (url.pathname === "/v1/me/playlists" && call.method === "POST") {
      const id = `archive${++account.created}`;
      account.playlists.set(id, { snapshot: 0, items: [] });
      return jsonResponse({ id, external_urls: { spotify: "https://open.spotify.com" } }, 201);
    }
    const match = url.pathname.match(/^\/v1\/playlists\/(\w+)(\/items)?$/);
    const list = match && account.playlists.get(match[1]!);
    if (!list) throw new Error(`Unexpected ${call.method} ${call.url}`);
    if (call.method === "GET") return jsonResponse({ snapshot_id: `s${list.snapshot}` });
    const body = call.body as { items?: { uri: string }[]; uris?: string[]; position?: number };
    if (call.method === "DELETE") list.items = list.items.filter((u) => !body.items!.some((i) => i.uri === u));
    if (call.method === "POST") list.items.splice(body.position ?? list.items.length, 0, ...body.uris!);
    list.snapshot++;
    return jsonResponse({ snapshot_id: `s${list.snapshot}` }, call.method === "POST" ? 201 : 200);
  });
}

function setup(account: Account, ids: string[], options: { fail?: (call: FetchCall) => boolean; gate?: Promise<void> } = {}) {
  const db = testDb();
  const config = testConfig();
  const settings = testSettings(db, config);
  connectSpotify(db);
  seed(
    db,
    ids.map((id) => track(id, `Song ${id}`, `Artist ${id}`, "Album", { durationMs: 200_000 })),
    [],
  );
  if (account.liked.length) db.insert(savedTracks).values(account.liked.map((u) => ({ uri: u, addedAt: NOW - 400 * DAY, syncedAt: NOW }))).run();
  for (const [id, list] of account.playlists) {
    db.insert(ownedPlaylists).values({ id, name: `List ${id}`, snapshotId: `s${list.snapshot}`, itemCount: list.items.length, syncedAt: NOW }).run();
    if (list.items.length) db.insert(playlistItems).values(list.items.map((u, position) => ({ playlistId: id, position, uri: u, addedAt: null }))).run();
  }
  const fake = fakeSpotify(account, options.fail, options.gate);
  const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, settings, fake.fn), settings, fake.fn);
  return { db, spotify, calls: fake.calls, deps: { db, spotify, now: () => NOW } };
}

const writes = (calls: FetchCall[]) => calls.map((c) => `${c.method} ${new URL(c.url).pathname.replace("/v1", "")}`);
const mirror = (db: Db, playlistId: string) => db.select({ uri: playlistItems.uri }).from(playlistItems).where(eq(playlistItems.playlistId, playlistId)).orderBy(playlistItems.position).all().map((r) => r.uri);
const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

async function apply(deps: Parameters<typeof startApply>[0], planId: number) {
  const started = startApply(deps, planId);
  await started.finished;
  return getBatch(deps.db, started.batchId);
}

async function undo(deps: Parameters<typeof startUndo>[0], batchId: number) {
  await startUndo(deps, batchId).finished;
  return getBatch(deps.db, batchId);
}

function likedPlan(db: Db, group: Parameters<typeof planFromGroup>[2] = { kind: "songs", where: "liked" }) {
  return planFromGroup(db, loadLibrary(db, NOW, { timezone: TZ }), group, NOW);
}

describe("rule plans", () => {
  function library() {
    const db = testDb();
    const shortPlays = (id: string, n: number, fromDay: number) => Array.from({ length: n }, (_, i) => play(ago(fromDay + i), uri(id), 3000, { skipped: true }));
    seed(
      db,
      ["nev", "cut", "rec", "dup", "ok"].map((id) => track(id, `Song ${id}`, `Artist ${id}`, "Album", { durationMs: 200_000 })),
      [
        ...shortPlays("cut", 10, 120),
        play(ago(130), uri("cut"), 200_000),
        ...shortPlays("rec", 10, 20),
        play(ago(5), uri("rec"), 200_000),
        play(ago(1), uri("ok"), 200_000),
        play(ago(1), uri("dup"), 200_000),
      ],
    );
    db.insert(savedTracks).values(["nev", "cut", "rec", "ok"].map((id) => ({ uri: uri(id), addedAt: NOW - 400 * DAY, syncedAt: NOW }))).run();
    for (const [id, items] of [["mine", ["dup", "cut", "dup"]], ["app", ["cut"]], ["set", ["cut"]]] as const) {
      db.insert(ownedPlaylists).values({ id, name: id, snapshotId: "s0", itemCount: items.length, syncedAt: NOW }).run();
      db.insert(playlistItems).values(items.map((t, position) => ({ playlistId: id, position, uri: uri(t), addedAt: null }))).run();
    }
    db.insert(appPlaylists).values({ purpose: "dj", playlistId: "app", createdAt: NOW }).run();
    const threadId = db.insert(llmThreads).values({ feature: "sets", system: "[]", messages: [], createdAt: NOW, updatedAt: NOW }).returning().get().id;
    db.insert(sets).values({ threadId, request: "r", title: "t", description: "", version: 1, playlistId: "set", createdAt: NOW, updatedAt: NOW }).run();
    return db;
  }

  test("each rule proposes its songs with a plain-word reason", () => {
    const proposals = computeProposals(library(), NOW, SETTINGS);

    expect(proposals.map((p) => [p.kind, p.playlistId, p.evidence.name, p.reason])).toEqual([
      ["saved_never_played", null, "Song nev", "Never played since Jul 2026"],
      ["saved_dislike", null, "Song cut", "Started 11 times, past 30 seconds once; last played Jul 2026"],
      ["playlist_duplicate", "mine", "Song dup", "2 copies in mine; the first stays"],
      ["playlist_skipped", "mine", "Song cut", "Started 11 times, past 30 seconds once; last played Jul 2026"],
    ]);
  });

  test("skips alone never put a song in a plan: a song cut short just as often but listened to last week stays out", () => {
    const keys = computeProposals(library(), NOW, SETTINGS).map((p) => p.key);

    expect(keys.some((k) => k.includes(uri("rec")) || k.endsWith(":song rec|artist rec"))).toBe(false);
  });

  test("no playlist encore owns is ever proposed", () => {
    const playlists = computeProposals(library(), NOW, SETTINGS).map((p) => p.playlistId);

    expect(playlists.filter((id) => id === "app" || id === "set")).toEqual([]);
  });

  test("the cut-short rule needs a low listen ratio: a song flagged skipped after long listens is kept", () => {
    const db = testDb();
    const longSkips = Array.from({ length: 8 }, (_, i) => play(ago(200 + i), uri("lng"), i < 5 ? 180_000 : 3000, { skipped: true }));
    seed(db, [track("lng", "Sinnerman", "Nina Simone", "Pastel Blues")], longSkips);
    db.insert(savedTracks).values({ uri: uri("lng"), addedAt: NOW - 400 * DAY, syncedAt: NOW }).run();

    const proposals = computeProposals(db, NOW, SETTINGS);

    expect([proposals, CLEANUP_RULES.dislikeMaxListenRatio]).toEqual([[], 0.2]);
  });

  test("each rule is a plan whose items default to archive, and duplicates keep one copy", () => {
    const db = library();
    refreshProposals(db, NOW, SETTINGS);

    const actions = db.all<{ title: string; action: string }>(sql`select p.title, c.action from cleanup_proposals c join library_plans p on p.id = c.plan_id order by c.id`);

    expect(actions).toEqual([
      { title: "Liked songs never played", action: "archive" },
      { title: "Liked songs rarely played through", action: "archive" },
      { title: "Extra copies in playlists", action: "dedupe" },
      { title: "Playlist songs rarely played through", action: "archive" },
    ]);
  });

  test("dismissed items stay dismissed across refreshes", () => {
    const db = library();
    refreshProposals(db, NOW, SETTINGS);
    db.run(sql`update cleanup_proposals set status = 'dismissed' where kind = 'saved_never_played'`);

    const counts = refreshProposals(db, NOW, SETTINGS);

    expect(counts.saved_never_played).toBe(0);
  });

  test("a refresh leaves the items of other plans alone", async () => {
    const db = library();
    likedPlan(db);

    refreshProposals(db, NOW, SETTINGS);

    expect(db.all(sql`select count(*) as n from cleanup_proposals where kind = 'plan'`)).toEqual([{ n: 4 }]);
  });
});

describe("carry-over of proposals from before plans", () => {
  test("old open, dismissed and applied proposals join their rule plan, open ones default to archive", () => {
    const db = testDb();
    const legacy = (key: string, kind: "saved_never_played" | "playlist_duplicate", status: "open" | "dismissed" | "applied") =>
      db.insert(cleanupProposals).values({ key, kind, playlistId: null, uri: uri(key), evidence: { name: key }, status, createdAt: 0, updatedAt: 0 }).returning().get();
    legacy("a", "saved_never_played", "open");
    legacy("b", "saved_never_played", "dismissed");
    legacy("c", "playlist_duplicate", "applied");

    ensureRulePlans(db, NOW);
    const plans = rulePlanIds(db);
    const never = getPlan(db, plans.saved_never_played, { status: "open", limit: 10, offset: 0 });

    expect([never.counts, never.items.map((i) => i.action), db.all(sql`select count(*) as n from cleanup_proposals where plan_id is null`)]).toEqual([
      { open: 1, selected: 1, dismissed: 1, applied: 0, skipped: 0 },
      ["archive"],
      [{ n: 0 }],
    ]);
  });

  test("a batch applied before plans still undoes: the songs are saved again and the items open again", async () => {
    const account: Account = { liked: [], playlists: new Map(), created: 0 };
    const { db, calls, deps } = setup(account, ["old"]);
    const item = db.insert(cleanupProposals).values({ key: "k", kind: "saved_never_played", playlistId: null, uri: uri("old"), evidence: {}, status: "applied", createdAt: 0, updatedAt: 0 }).returning().get();
    const batch = db.insert(cleanupBatches).values({ proposalIds: [item.id], undo: [{ type: "library_save", uris: [uri("old")] }], appliedAt: 0 }).returning().get();
    ensureRulePlans(db, NOW);

    const after = await undo(deps, batch.id);

    expect([after.undo.status, account.liked, writes(calls), db.select({ status: cleanupProposals.status }).from(cleanupProposals).all()]).toEqual([
      "done",
      [uri("old")],
      ["PUT /me/library"],
      [{ status: "open" }],
    ]);
  });
});

describe("applying a plan", () => {
  test("archive adds the songs to one private archive playlist made on the first archive, then takes them out of the liked songs", async () => {
    const account: Account = { liked: [uri("a"), uri("b")], playlists: new Map(), created: 0 };
    const { db, calls, deps } = setup(account, ["a", "b"]);
    const first = likedPlan(db, { kind: "songs", where: "liked", artist: "Artist a" });
    const second = likedPlan(db, { kind: "songs", where: "liked", artist: "Artist b" });

    await apply(deps, first);
    await apply(deps, second);

    expect([writes(calls), account.liked, account.playlists.get("archive1")!.items, db.select().from(appPlaylists).all().map((r) => r.purpose)]).toEqual([
      ["POST /me/playlists", "POST /playlists/archive1/items", "DELETE /me/library", "POST /playlists/archive1/items", "DELETE /me/library"],
      [],
      [uri("a"), uri("b")],
      ["archive"],
    ]);
  });

  test("undo of an archive puts the song back where it was and takes it out of the archive", async () => {
    const account: Account = { liked: [uri("a")], playlists: new Map([["p1", { snapshot: 0, items: [uri("x"), uri("a"), uri("y")] }]]), created: 0 };
    const { db, deps } = setup(account, ["a", "x", "y"]);
    const fromLiked = await apply(deps, likedPlan(db, { kind: "songs", where: "liked" }));
    const fromPlaylist = await apply(deps, likedPlan(db, { kind: "songs", where: "p1", artist: "Artist a" }));

    await undo(deps, fromPlaylist.id);
    await undo(deps, fromLiked.id);

    expect([account.liked, account.playlists.get("p1")!.items, account.playlists.get("archive1")!.items, mirror(db, "p1")]).toEqual([
      [uri("a")],
      [uri("x"), uri("a"), uri("y")],
      [],
      [uri("x"), uri("a"), uri("y")],
    ]);
  });

  test("an archived song another batch still relies on stays in the archive when one batch is undone", async () => {
    const account: Account = { liked: [uri("a")], playlists: new Map([["p1", { snapshot: 0, items: [uri("a")] }]]), created: 0 };
    const { db, deps } = setup(account, ["a"]);
    const fromLiked = await apply(deps, likedPlan(db, { kind: "songs", where: "liked" }));
    await apply(deps, likedPlan(db, { kind: "songs", where: "p1" }));

    await undo(deps, fromLiked.id);

    expect(account.playlists.get("archive1")!.items).toEqual([uri("a"), uri("a")]);
  });

  test("remove skips the archive", async () => {
    const account: Account = { liked: [uri("a")], playlists: new Map(), created: 0 };
    const { db, calls, deps } = setup(account, ["a"]);
    const planId = likedPlan(db);
    updateItems(db, planId, { ids: "all", action: "remove" }, NOW);

    const batch = await apply(deps, planId);

    expect([writes(calls), batch.actions.remove, account.created]).toEqual([["DELETE /me/library"], 1, 0]);
  });

  test("unticked items are left out", async () => {
    const account: Account = { liked: [uri("a"), uri("b")], playlists: new Map(), created: 0 };
    const { db, deps } = setup(account, ["a", "b"]);
    const planId = likedPlan(db);
    const [first] = getPlan(db, planId, { status: "open", limit: 10, offset: 0 }).items;
    updateItems(db, planId, { ids: [first!.id], included: false }, NOW);

    await apply(deps, planId);

    expect(account.liked).toEqual([first!.uri]);
  });

  test("a group selection changes only the items of that action on that place", () => {
    const { db } = setup({ liked: [], playlists: new Map(), created: 0 }, ["a", "b"]);
    const item = (u: string, playlistId: string | null) => ({ action: "archive" as const, playlistId, uri: uri(u), reason: "r", evidence: {} });
    const planId = createPlan(db, { source: "claude", title: "t", summary: "", items: [item("a", null), item("b", null), item("a", "p1")] }, NOW);

    updateItems(db, planId, { ids: { action: "archive", where: "liked" }, action: "remove" }, NOW);

    expect(getPlan(db, planId, { status: "open", limit: 10, offset: 0 }).groups.map((g) => [g.action, g.where.kind, g.items])).toEqual([
      ["remove", "liked", 2],
      ["archive", "playlist", 1],
    ]);
  });

  test("library writes go in batches of 40: 45 liked songs archived cost 1 create, 1 archive add and 2 removals", async () => {
    const names = ids(45, "s");
    const account: Account = { liked: names.map(uri), playlists: new Map(), created: 0 };
    const { db, calls, deps } = setup(account, names);

    const batch = await apply(deps, likedPlan(db));

    expect([writes(calls), batch.applied, batch.calls]).toEqual([["POST /me/playlists", "POST /playlists/archive1/items", "DELETE /me/library", "DELETE /me/library"], 45, 4]);
  });

  test("8 duplicates in one playlist: one snapshot check, one removal, the kept copies back in place, and the playlist order kept", async () => {
    const items = ["k0", "d0", "x0", "k1", "k2", "d1", "x1", "k3", "d2", "k4", "k5", "k6", "k7", "d3", "d4", "d5", "d6", "d7"];
    const order = items.map((i) => uri(i.startsWith("d") ? `k${i.slice(1)}` : i));
    const account: Account = { liked: [], playlists: new Map([["p1", { snapshot: 0, items: order }]]), created: 0 };
    const { db, calls, deps } = setup(account, ["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7", "x0", "x1"]);
    const expected = ["k0", "x0", "k1", "k2", "x1", "k3", "k4", "k5", "k6", "k7"].map(uri);

    const batch = await apply(deps, likedPlan(db, { kind: "duplicates", where: "p1" }));

    expect([account.playlists.get("p1")!.items, mirror(db, "p1"), writes(calls).length, batch.applied]).toEqual([expected, expected, 1 + 1 + 3, 8]);
  });

  test("undo of the duplicates restores every copy at its old position", async () => {
    const order = ["a", "b", "a", "c", "b", "a"].map(uri);
    const account: Account = { liked: [], playlists: new Map([["p1", { snapshot: 0, items: [...order] }]]), created: 0 };
    const { db, deps } = setup(account, ["a", "b", "c"]);
    const batch = await apply(deps, likedPlan(db, { kind: "duplicates", where: "p1" }));

    await undo(deps, batch.id);

    expect([account.playlists.get("p1")!.items, mirror(db, "p1")]).toEqual([order, order]);
  });

  test("8 songs taken out of one playlist cost a snapshot check, one archive add and one removal", async () => {
    const names = ids(8, "t");
    const account: Account = { liked: [], playlists: new Map([["p1", { snapshot: 0, items: [uri("keep"), ...names.map(uri)] }]]), created: 0 };
    const { db, calls, deps } = setup(account, [...names, "keep"]);

    await apply(deps, likedPlan(db, { kind: "songs", where: "p1", classes: ["never"] }));

    expect([writes(calls), account.playlists.get("p1")!.items]).toEqual([["GET /playlists/p1", "POST /me/playlists", "POST /playlists/archive1/items", "DELETE /playlists/p1/items"], []]);
  });

  test("stale items are skipped with the reason: a song no longer liked, a playlist changed in Spotify since the last sync", async () => {
    const account: Account = { liked: [uri("a"), uri("b")], playlists: new Map([["p1", { snapshot: 0, items: [uri("c")] }]]), created: 0 };
    const { db, deps } = setup(account, ["a", "b", "c"]);
    const liked = likedPlan(db);
    const fromPlaylist = likedPlan(db, { kind: "songs", where: "p1" });
    db.delete(savedTracks).where(eq(savedTracks.uri, uri("b"))).run();
    account.playlists.get("p1")!.snapshot = 9;

    const one = await apply(deps, liked);
    const two = await apply(deps, fromPlaylist);

    expect([one.status, one.applied, one.skipped.map((s) => s.reason), two.status, two.skipped.map((s) => s.reason), db.select().from(ownedPlaylists).get()!.syncedAt]).toEqual([
      "done",
      1,
      ["No longer in your liked songs"],
      "done",
      ["The playlist changed in Spotify since the last sync"],
      null,
    ]);
  });

  test("a failure part way records exactly what was applied, and undo restores only that", async () => {
    const names = ids(45, "s");
    const account: Account = { liked: names.map(uri), playlists: new Map(), created: 0 };
    let removals = 0;
    const { db, deps } = setup(account, names, { fail: (c) => c.method === "DELETE" && c.url.includes("/me/library") && ++removals === 2 });
    const planId = likedPlan(db);
    updateItems(db, planId, { ids: "all", action: "remove" }, NOW);

    const batch = await apply(deps, planId);
    const stillLiked = [...account.liked];
    const [recorded] = db.select().from(cleanupBatches).get()!.undo;
    const restored = await undo(deps, batch.id);

    expect([batch.status, batch.applied, batch.notApplied.length, stillLiked.length, recorded!.type, recorded?.type === "library_save" && recorded.uris.some((u) => stillLiked.includes(u)), restored.undo.status, account.liked.length]).toEqual([
      "partial",
      40,
      5,
      5,
      "library_save",
      false,
      "done",
      45,
    ]);
  });

  test("an undo that stops part way keeps what is left to send, and a second undo finishes it", async () => {
    const account: Account = { liked: [uri("a")], playlists: new Map([["p1", { snapshot: 0, items: [uri("b")] }]]), created: 0 };
    let failPut = true;
    const { db, deps } = setup(account, ["a", "b"], { fail: (c) => c.method === "PUT" && failPut });
    const fromLiked = likedPlan(db, { kind: "songs", where: "liked" });
    await apply(deps, fromLiked);

    const failed = await undo(deps, getBatch(db, 1).id);
    failPut = false;
    const finished = await undo(deps, 1);

    expect([failed.undo.status, failed.canUndo, finished.undo.status, account.liked, account.playlists.get("archive1")!.items]).toEqual(["failed", true, "done", [uri("a")], []]);
  });

  test("a one-off plan is applied once every ticked item is done, and opens again after undo", async () => {
    const account: Account = { liked: [uri("a")], playlists: new Map(), created: 0 };
    const { db, deps } = setup(account, ["a"]);
    const planId = likedPlan(db);

    const batch = await apply(deps, planId);
    const applied = db.select({ status: libraryPlans.status }).from(libraryPlans).get()!.status;
    await undo(deps, batch.id);

    expect([applied, db.select({ status: libraryPlans.status }).from(libraryPlans).get()!.status]).toEqual(["applied", "open"]);
  });

  test("a second apply while one runs is refused", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const account: Account = { liked: [uri("a"), uri("b")], playlists: new Map(), created: 0 };
    const { db, deps } = setup(account, ["a", "b"], { gate });
    const first = likedPlan(db, { kind: "songs", where: "liked", artist: "Artist a" });
    const second = likedPlan(db, { kind: "songs", where: "liked", artist: "Artist b" });
    const running = startApply(deps, first);

    const refused = (() => {
      try {
        startApply(deps, second);
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    })();
    release();
    await running.finished;

    expect(refused).toBe("Another change is still being applied or undone");
  });

  test("apply calls queue ahead of background job calls, even when started from a job", async () => {
    const account: Account = { liked: [uri("a")], playlists: new Map(), created: 0 };
    const { db, spotify, calls, deps } = setup(account, ["a"]);
    const planId = likedPlan(db);
    updateItems(db, planId, { ids: "all", action: "remove" }, NOW);
    account.playlists.set("bg", { snapshot: 0, items: [] });

    const background = [1, 2, 3].map(() => inBackground(() => spotify.request("GET", "/playlists/bg?fields=snapshot_id")));
    const started = inBackground(() => startApply(deps, planId));
    await Promise.all([...background, started.finished]);

    expect(writes(calls)).toEqual(["GET /playlists/bg", "DELETE /me/library", "GET /playlists/bg", "GET /playlists/bg"]);
  });

  test("after a restart a batch cut off part way reads as partly applied", () => {
    const db = testDb();
    db.insert(cleanupBatches).values({ proposalIds: [1], selectedIds: [1, 2], undo: [], status: "running", appliedAt: 0 }).run();

    recoverInterrupted(db, NOW);

    expect(getBatch(db, 1)).toMatchObject({ status: "partial", applied: 1, error: "Stopped when encore restarted", canUndo: false });
  });
});

describe("plan routes", () => {
  test("apply answers at once with the running batch; the work finishes after the client has gone and its state stays readable", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const account: Account = { liked: [uri("a")], playlists: new Map(), created: 0 };
    const fake = fakeSpotify(account, () => false, gate);
    const app = testApp({}, fake.fn);
    connectSpotify(app.db);
    seed(app.db, [track("a", "Song a", "Artist a", "Album")], []);
    app.db.insert(savedTracks).values({ uri: uri("a"), addedAt: NOW - 400 * DAY, syncedAt: NOW }).run();
    const cookie = `encore_session=${createSession(app.db)}`;
    const { id } = (await (await app.request("/api/library/plans", { json: { group: { kind: "songs", where: "liked" } }, headers: { cookie } })).json()) as { id: number };

    const response = await app.request(`/api/library/plans/${id}/apply`, { method: "POST", headers: { cookie } });
    const started = (await response.json()) as { batch: { id: number; status: string } };
    const again = await app.request(`/api/library/plans/${id}/apply`, { method: "POST", headers: { cookie } });
    release();
    for (let i = 0; i < 50 && getBatch(app.db, started.batch.id).status === "running"; i++) await Bun.sleep(5);
    const later = (await (await app.request(`/api/library/batches/${started.batch.id}`, { headers: { cookie } })).json()) as { batch: { status: string; applied: number } };

    expect([response.status, started.batch.status, again.status, later.batch.status, later.batch.applied, account.liked]).toEqual([202, "running", 409, "done", 1, []]);
  });

  test("apply needs a session and a connected Spotify", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const anonymous = await app.request("/api/library/plans/1/apply", { method: "POST" });
    const disconnected = await app.request("/api/library/plans/1/apply", { method: "POST", headers: { cookie } });

    expect([anonymous.status, disconnected.status]).toEqual([401, 409]);
  });

  test("the plan list carries the four rule plans", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const body = (await (await app.request("/api/library/plans", { headers: { cookie } })).json()) as { items: { ruleKind: string }[] };

    expect(body.items.map((p) => p.ruleKind).sort()).toEqual(["playlist_duplicate", "playlist_skipped", "saved_dislike", "saved_never_played"]);
  });
});
