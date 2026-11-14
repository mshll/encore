import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { sql } from "drizzle-orm";
import { proposalCounts, refreshProposals } from "../src/library/rules";
import { createDiscord } from "../src/discord";
import { InteractionType } from "../src/discord/types";
import { runJob } from "../src/jobs/scheduler";
import { syncStep, type SyncCursor } from "../src/library/sync";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import type { SpotifyTrack } from "../src/spotify/types";
import { connectSpotify, jsonResponse, noContent, play, routeFetch, seed, testApp, testConfig, testDb, track, uri, type FetchCall, testSettings, TZ, WEEKEND } from "./helpers";

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
  const settings = testSettings(db, config);
  connectSpotify(db, "owner");
  const skipped = (id: string, n: number) => Array.from({ length: n }, (_, i) => play(new Date(NOW - (i + 1) * DAY).toISOString(), uri(id), 3000, { skipped: true }));
  seed(db, ["skp", "ok"].map((id) => track(id, `Song ${id}`, `Artist ${id}`, "Album")), [...skipped("skp", 10), play(new Date(NOW - DAY).toISOString(), uri("ok"), 200_000)]);
  const { fn, calls } = libraryFetch(lib, extra);
  const auth = new SpotifyAuth(db, config, settings, fn);
  const spotify = new SpotifyClient(db, auth, settings, fn);
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

describe("apply is unreachable from automated paths", () => {
  const srcDir = join(import.meta.dir, "../src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  const sources = files(srcDir).map((f) => ({ path: relative(srcDir, f), text: readFileSync(f, "utf8") }));

  test("only the library HTTP route and the startup recovery import the apply module", () => {
    const importers = sources.filter((s) => /from\s+"[./]+(library\/)?apply"/.test(s.text) && s.path !== "library/apply.ts").map((s) => s.path);

    expect(importers.sort()).toEqual(["http/routes/library.ts", "main.ts"]);
  });

  test("library removal and playlist item removal are only written in apply and the app-owned playlist guard", () => {
    const deletes = sources.filter((s) => /"DELETE",\s*`\/(me\/library|playlists\/)/.test(s.text)).map((s) => s.path);
    expect(deletes.sort()).toEqual(["dj/playlists.ts", "library/apply.ts"]);
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
    refreshProposals(app.db, Date.now(), { timezone: TZ, weekendDays: WEEKEND });
    expect(proposalCounts(app.db).saved_never_played).toBeGreaterThan(0);

    const discord = createDiscord(app.settings.get().discord!, { db: app.db, config: app.config, settings: app.settings, services: app.services, now: Date.now }, fn);
    for (const definition of discord.registry.definitions()) {
      const options = definition.options?.filter((o) => o.required).map((o) => ({ name: o.name, value: "ok" }));
      await discord.interactions.handle({ id: "i", type: InteractionType.Command, token: "t", application_id: "1", member: { user: { id: "42" } }, data: { name: definition.name, options } });
    }
    await discord.interactions.handle({ id: "i", type: InteractionType.Component, token: "t", application_id: "1", user: { id: "42" }, data: { custom_id: `queue:${uri("ok")}` } });
    await discord.interactions.whenIdle();
    expect(removals).toEqual([]);
    expect(app.db.all(sql`select count(*) as n from cleanup_proposals where status = 'applied'`)).toEqual([{ n: 0 }]);
  });
});
