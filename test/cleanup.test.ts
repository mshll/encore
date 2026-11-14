import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { sql } from "drizzle-orm";
import { createSession } from "../src/auth/sessions";
import { applyCleanup, undoCleanup } from "../src/cleanup/apply";
import { CLEANUP_RULES, computeProposals, listProposals, refreshProposals } from "../src/cleanup/proposals";
import { savedTracks } from "../src/db/schema";
import { createDiscord } from "../src/discord";
import { InteractionType } from "../src/discord/types";
import { runJob } from "../src/jobs/scheduler";
import { syncStep, type SyncCursor } from "../src/library/sync";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import type { SpotifyTrack } from "../src/spotify/types";
import { connectSpotify, jsonResponse, noContent, play, routeFetch, seed, testApp, testConfig, testDb, track, uri, type FetchCall } from "./helpers";

const NOW = Date.parse("2026-11-14T09:00:00Z");
const DAY = 86_400_000;
const spotifyTrack = (id: string, name = `Song ${id}`): SpotifyTrack => ({
  id: uri(id).split(":")[2]!,
  uri: uri(id),
  name,
  duration_ms: 200_000,
  artists: [{ id: `ar${id}`, name: `Artist ${id}`, uri: `spotify:artist:ar${id}` }],
  album: { id: "al", name: "Album" },
});

type Library = { saved: { id: string; addedAt: number }[]; playlists: { id: string; owner: string; snapshot: string; items: string[] }[] };

function libraryFetch(lib: Library, extra: (call: FetchCall) => Response | undefined = () => undefined) {
  return routeFetch((call) => {
    const custom = extra(call);
    if (custom) return custom;
    const url = new URL(call.url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const page = <T>(all: T[]) => ({ items: all.slice(offset, offset + limit), total: all.length, offset, limit, next: offset + limit < all.length ? "more" : null });
    if (url.pathname === "/v1/me/tracks") return jsonResponse(page(lib.saved.map((s) => ({ added_at: new Date(s.addedAt).toISOString(), track: spotifyTrack(s.id) }))));
    if (url.pathname === "/v1/me/playlists") return jsonResponse(page(lib.playlists.map((p) => ({ id: p.id, uri: `spotify:playlist:${p.id}`, name: `List ${p.id}`, snapshot_id: p.snapshot, owner: { id: p.owner }, items: { total: p.items.length } }))));
    const items = url.pathname.match(/^\/v1\/playlists\/(\w+)\/items$/);
    if (items && call.method === "GET") return jsonResponse(page(lib.playlists.find((p) => p.id === items[1])!.items.map((id) => ({ added_at: null, item: spotifyTrack(id) }))));
    if (call.method !== "GET") return call.method === "DELETE" && url.pathname.includes("/items") ? jsonResponse({ snapshot_id: "x" }) : noContent();
    return undefined;
  });
}

async function syncAll(db: ReturnType<typeof testDb>, spotify: SpotifyClient, auth: SpotifyAuth, now = NOW) {
  let cursor: SyncCursor = { phase: "idle", completedAt: null };
  let calls = 0;
  for (let i = 0; i < 100; i++) {
    const step = await syncStep({ db, spotify, spotifyAuth: auth, appPlaylistIds: () => ["app"] }, cursor, now);
    cursor = step.cursor;
    calls += step.calls;
    if (step.passCompleted) return calls;
  }
  throw new Error("sync did not finish");
}

function seeded(lib: Library, extra?: (call: FetchCall) => Response | undefined) {
  const db = testDb();
  const config = testConfig();
  connectSpotify(db, "owner");
  const skipped = (id: string, n: number) => Array.from({ length: n }, (_, i) => play(new Date(NOW - (i + 1) * DAY).toISOString(), uri(id), 3000, { skipped: true }));
  seed(db, ["skp", "ok"].map((id) => track(id, `Song ${id}`, `Artist ${id}`, "Album")), [...skipped("skp", 10), play(new Date(NOW - DAY).toISOString(), uri("ok"), 200_000)]);
  const { fn, calls } = libraryFetch(lib, extra);
  const auth = new SpotifyAuth(db, config, fn);
  const spotify = new SpotifyClient(db, auth, config, fn);
  return { db, config, spotify, auth, calls };
}

const library = (): Library => ({
  saved: [
    ...Array.from({ length: 120 }, (_, i) => ({ id: `n${i}`, addedAt: NOW - 400 * DAY })),
    { id: "new", addedAt: NOW - 2 * DAY },
    { id: "skp", addedAt: NOW - 400 * DAY },
    { id: "ok", addedAt: NOW - 400 * DAY },
  ],
  playlists: [
    { id: "mine", owner: "owner", snapshot: "s1", items: ["ok", "skp", "ok", "n1"] },
    { id: "theirs", owner: "friend", snapshot: "s1", items: ["skp"] },
    { id: "app", owner: "owner", snapshot: "s1", items: ["skp"] },
  ],
});

describe("library sync", () => {
  test("pages through saved songs and own playlists, one call per step, and resumes from its cursor", async () => {
    const { db, spotify, auth, calls } = seeded(library());
    expect(await syncAll(db, spotify, auth)).toBe(3 + 1 + 1);
    expect(db.all(sql`select count(*) as n from saved_tracks`)).toEqual([{ n: 123 }]);
    expect(db.all(sql`select id from owned_playlists`)).toEqual([{ id: "mine" }]);
    expect(db.all(sql`select uri from playlist_items order by position`).map((r) => (r as { uri: string }).uri)).toEqual([uri("ok"), uri("skp"), uri("ok"), uri("n1")]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    calls.length = 0;
    expect(await syncAll(db, spotify, auth)).toBe(3 + 1);
    expect(calls.some((c) => c.url.includes("/playlists/mine/items"))).toBe(false);
  });

  test("a song removed from the library disappears after the next full pass", async () => {
    const lib = library();
    const { db, spotify, auth } = seeded(lib);
    await syncAll(db, spotify, auth);
    lib.saved = lib.saved.filter((s) => s.id !== "n5");
    await syncAll(db, spotify, auth, NOW + DAY);
    expect(db.all(sql`select count(*) as n from saved_tracks`)).toEqual([{ n: 122 }]);
  });
});

describe("cleanup proposals", () => {
  test("rules: never played, dislike, nearly always skipped in a playlist, duplicates; each with evidence", async () => {
    const { db, spotify, auth } = seeded(library());
    await syncAll(db, spotify, auth);
    const proposals = computeProposals(db, NOW);
    const byKind = (kind: string) => proposals.filter((p) => p.kind === kind);
    expect(byKind("saved_never_played")).toHaveLength(120);
    expect(byKind("saved_never_played").some((p) => p.uri === uri("new"))).toBe(false);
    expect(byKind("saved_dislike").map((p) => p.uri)).toEqual([uri("skp")]);
    expect(byKind("saved_dislike")[0]!.evidence).toMatchObject({ plays: 10, skips: 10, skipRate: 1, lastPlayed: new Date(NOW - DAY).toISOString() });
    expect(byKind("playlist_skipped").map((p) => [p.playlistId, p.uri])).toEqual([["mine", uri("skp")]]);
    expect(byKind("playlist_duplicate")[0]).toMatchObject({ playlistId: "mine", uri: uri("ok"), evidence: { keep: { position: 0 }, duplicates: [{ position: 2, uri: uri("ok") }] } });
  });

  test("saved_dislike needs a low listen ratio: songs skipped after long listens are kept", () => {
    const db = testDb();
    const longSkips = Array.from({ length: 8 }, (_, i) => play(new Date(NOW - (i + 1) * DAY).toISOString(), uri("lng"), i < 5 ? 180_000 : 3000, { skipped: true }));
    const shortSkips = Array.from({ length: 10 }, (_, i) => play(new Date(NOW - (i + 1) * DAY).toISOString(), uri("sht"), i < 2 ? 40_000 : 3000, { skipped: true }));
    seed(db, [track("lng", "Sinnerman", "Nina Simone", "Pastel Blues"), track("sht", "Short", "Artist", "A")], [...longSkips, ...shortSkips]);
    db.insert(savedTracks).values([uri("lng"), uri("sht")].map((u) => ({ uri: u, addedAt: NOW - 400 * DAY, syncedAt: NOW }))).run();
    const dislikes = computeProposals(db, NOW).filter((p) => p.kind === "saved_dislike");
    expect(dislikes.map((p) => p.evidence.name)).toEqual(["Short"]);
    expect(dislikes[0]!.evidence).toMatchObject({ plays: 10, listens: 2, listenRatio: 0.2 });
    expect(CLEANUP_RULES.dislikeMaxListenRatio).toBe(0.2);
  });

  test("dismissed proposals stay dismissed across refreshes", async () => {
    const { db, spotify, auth } = seeded(library());
    await syncAll(db, spotify, auth);
    refreshProposals(db, NOW);
    const target = listProposals(db, { kind: "saved_dislike", status: "open", limit: 10, offset: 0 }).items[0]!;
    db.run(sql`update cleanup_proposals set status = 'dismissed' where id = ${target.id}`);
    expect(refreshProposals(db, NOW).saved_dislike).toBe(0);
  });

  test("apply removes only the chosen items and records an undo log that restores them", async () => {
    const { db, spotify, auth, calls } = seeded(library());
    await syncAll(db, spotify, auth);
    refreshProposals(db, NOW);
    const open = (kind: string) => listProposals(db, { kind: kind as never, status: "open", limit: 500, offset: 0 }).items;
    const ids = [open("saved_dislike")[0]!.id, open("playlist_duplicate")[0]!.id, open("playlist_skipped")[0]!.id];
    calls.length = 0;
    const result = await applyCleanup(db, spotify, ids, NOW);
    expect(result.applied).toBe(3);
    const writes = calls.map((c) => [c.method, decodeURIComponent(c.url.replace("https://api.spotify.com/v1", "")), c.body]);
    expect(writes).toEqual([
      ["DELETE", `/me/library?uris=${uri("skp")}`, undefined],
      ["DELETE", "/playlists/mine/items", { items: [{ uri: uri("ok") }] }],
      ["POST", "/playlists/mine/items", { uris: [uri("ok")], position: 0 }],
      ["DELETE", "/playlists/mine/items", { items: [{ uri: uri("skp") }] }],
    ]);
    expect(listProposals(db, { status: "applied", limit: 10, offset: 0 }).total).toBe(3);
    await expect(applyCleanup(db, spotify, ids, NOW)).rejects.toThrow("not open");

    calls.length = 0;
    await undoCleanup(db, spotify, result.batchId, NOW + 1);
    expect(calls.map((c) => [c.method, decodeURIComponent(c.url.replace("https://api.spotify.com/v1", "")), c.body])).toEqual([
      ["PUT", `/me/library?uris=${uri("skp")}`, undefined],
      ["POST", "/playlists/mine/items", { uris: [uri("skp")], position: 1 }],
      ["POST", "/playlists/mine/items", { uris: [uri("ok")], position: 2 }],
    ]);
    expect(listProposals(db, { status: "open", kind: "saved_dislike", limit: 10, offset: 0 }).total).toBe(1);
    await expect(undoCleanup(db, spotify, result.batchId, NOW + 2)).rejects.toThrow("already undone");
  });

  test("apply needs an explicit list of open proposal ids", async () => {
    const { db, spotify, calls } = seeded(library());
    await expect(applyCleanup(db, spotify, [], NOW)).rejects.toThrow("at least one");
    await expect(applyCleanup(db, spotify, [999], NOW)).rejects.toThrow("not open");
    expect(calls).toHaveLength(0);
  });

  test("apply over HTTP requires a session and a body with ids", async () => {
    const app = testApp();
    expect((await app.request("/api/cleanup/apply", { json: { ids: [1] } })).status).toBe(401);
    const cookie = `encore_session=${createSession(app.db)}`;
    expect((await app.request("/api/cleanup/apply", { json: {}, headers: { cookie } })).status).toBe(400);
    expect((await app.request("/api/cleanup/apply", { json: { ids: [1] }, headers: { cookie } })).status).toBe(400);
  });
});

describe("apply is unreachable from automated paths", () => {
  const srcDir = join(import.meta.dir, "../src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  const sources = files(srcDir).map((f) => ({ path: relative(srcDir, f), text: readFileSync(f, "utf8") }));

  test("only the cleanup HTTP route imports the apply module", () => {
    expect(sources.filter((s) => /from\s+"[./]+(cleanup\/)?apply"/.test(s.text) && s.path !== "cleanup/apply.ts").map((s) => s.path)).toEqual(["http/routes/cleanup.ts"]);
  });

  test("library removal and playlist item removal are only written in apply and the app-owned playlist guard", () => {
    const deletes = sources.filter((s) => /"DELETE",\s*`\/(me\/library|playlists\/)/.test(s.text)).map((s) => s.path);
    expect(deletes.sort()).toEqual(["cleanup/apply.ts", "dj/playlists.ts"]);
  });

  test("running every job and every Discord command and button sends no removal to Spotify", async () => {
    const lib = library();
    const removals: FetchCall[] = [];
    const { fn } = libraryFetch(lib, (call) => {
      if (call.method === "DELETE") removals.push(call);
      if (call.url.includes("/me/player/recently-played")) return jsonResponse({ items: [] });
      if (call.url.includes("/me/player")) return call.method === "GET" ? noContent() : noContent();
      if (call.url.includes("/search")) return jsonResponse({ tracks: { items: [spotifyTrack("ok")] } });
      if (call.url.includes("/albums")) return jsonResponse({ items: [], total: 0, next: null });
      if (/\/tracks\/|\/artists\//.test(call.url)) return jsonResponse({ ...spotifyTrack("ok"), images: [] });
      if (call.url.includes("oembed")) return jsonResponse({});
      if (call.url.includes("discord.com")) return jsonResponse({ id: "m" });
      return undefined;
    });
    const app = testApp({ DISCORD_APPLICATION_ID: "1", DISCORD_PUBLIC_KEY: "a".repeat(64), DISCORD_OWNER_ID: "42", RADAR_MIN_LISTENS: "1" }, fn);
    connectSpotify(app.db, "owner");
    seed(app.db, [track("ok", "Song ok", "Artist ok", "Album")], [play(new Date(Date.now() - DAY).toISOString(), uri("ok"), 200_000)]);
    for (let i = 0; i < 12; i++) for (const job of Object.values(app.jobs)) await runJob(app.db, job);
    refreshProposals(app.db, Date.now());
    expect(listProposals(app.db, { status: "open", limit: 500, offset: 0 }).total).toBeGreaterThan(0);

    const discord = createDiscord(app.config.discord!, { db: app.db, config: app.config, services: app.services, now: Date.now }, fn);
    for (const definition of discord.registry.definitions()) {
      const options = definition.options?.filter((o) => o.required).map((o) => ({ name: o.name, value: "ok" }));
      await discord.interactions.handle({ id: "i", type: InteractionType.Command, token: "t", application_id: "1", member: { user: { id: "42" } }, data: { name: definition.name, options } });
    }
    await discord.interactions.handle({ id: "i", type: InteractionType.Component, token: "t", application_id: "1", user: { id: "42" }, data: { custom_id: `queue:${uri("ok")}` } });
    await discord.interactions.whenIdle();
    expect(removals).toEqual([]);
    expect(listProposals(app.db, { status: "applied", limit: 10, offset: 0 }).total).toBe(0);
  });
});
