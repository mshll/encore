import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { releases, spotifyAuth } from "../src/db/schema";
import { MCP_TOOLS } from "../src/mcp/server";
import { connectSpotify, jsonResponse, noContent, play, routeFetch, seed, testApp, track, uri, type FetchCall } from "./helpers";

const TOKEN = "mcp-token-mcp-token-mcp-token";
const headers = (token?: string) => ({
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});
const rpc = (method: string, params: unknown = {}, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const init = rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });

async function body(res: Response) {
  const text = await res.text();
  const data = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data: "))!.slice(6);
  return JSON.parse(data) as { result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }; error?: unknown };
}

describe("mcp endpoint", () => {
  test("is disabled without MCP_TOKEN", async () => {
    const { app } = testApp();
    expect((await app.request("/mcp", { method: "POST", body: init, headers: headers(TOKEN) })).status).toBe(404);
  });

  test("rejects a missing or wrong bearer token, and the session cookie does not count", async () => {
    const { app } = testApp({ MCP_TOKEN: TOKEN });
    expect((await app.request("/mcp", { method: "POST", body: init, headers: headers() })).status).toBe(401);
    expect((await app.request("/mcp", { method: "POST", body: init, headers: headers("wrong-token-wrong-token-wrong") })).status).toBe(401);
  });

  test("lists every tool the consent page names, and answers a tool call", async () => {
    const { app, db } = testApp({ MCP_TOKEN: TOKEN });
    seed(db, [track("a", "Song A", "Artist", "Album")], [play("2026-01-01T10:00:00Z", uri("a"), 200_000)]);
    expect((await app.request("/mcp", { method: "POST", body: init, headers: headers(TOKEN) })).status).toBe(200);
    const list = await body(await app.request("/mcp", { method: "POST", body: rpc("tools/list", {}, 2), headers: { ...headers(TOKEN), "mcp-protocol-version": "2025-06-18" } }));
    expect([...MCP_TOOLS.read, ...MCP_TOOLS.playback, ...MCP_TOOLS.write].sort() as string[]).toEqual(list.result!.tools!.map((t) => t.name).sort());
    const call = await body(
      await app.request("/mcp", { method: "POST", body: rpc("tools/call", { name: "overview", arguments: {} }, 3), headers: { ...headers(TOKEN), "mcp-protocol-version": "2025-06-18" } }),
    );
    expect(JSON.parse(call.result!.content![0]!.text)).toMatchObject({ plays: 1, topTrack: { name: "Song A" } });
  });
});

const ALL_SCOPES = "playlist-modify-private playlist-modify-public user-read-playback-state user-modify-playback-state";
const id = (n: number) => String(n).padStart(22, "0");

function spotifyMcp(respond: (call: FetchCall) => Response | undefined, scopes = ALL_SCOPES) {
  const { fn, calls } = routeFetch(respond);
  const { app, db } = testApp({ MCP_TOKEN: TOKEN }, fn);
  connectSpotify(db);
  db.update(spotifyAuth).set({ scope: scopes }).where(eq(spotifyAuth.id, 1)).run();
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await app.request("/mcp", { method: "POST", body: rpc("tools/call", { name, arguments: args }, 2), headers: { ...headers(TOKEN), "mcp-protocol-version": "2025-06-18" } });
    const result = (await body(res)).result!;
    return { isError: result.isError ?? false, text: result.content![0]!.text };
  };
  return { call, calls, db };
}

const writes = (calls: FetchCall[]) => calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`);

describe("mcp playlist tools", () => {
  test("create_playlist makes a private playlist and adds the tracks once each, 100 per request", async () => {
    const { call, calls } = spotifyMcp((c) => (c.url.endsWith("/me/playlists") ? jsonResponse({ id: "p1", external_urls: { spotify: "https://open.spotify.com/playlist/p1" } }, 201) : jsonResponse({ snapshot_id: "s" }, 201)));
    const tracks = [...Array.from({ length: 150 }, (_, i) => `spotify:track:${id(i)}`), id(0), { uri: `spotify:track:${id(1)}`, name: "from forgotten" }];

    const result = await call("create_playlist", { name: "Forgotten", tracks });

    expect(JSON.parse(result.text)).toEqual({ id: "p1", url: "https://open.spotify.com/playlist/p1", added: 150 });
    expect(calls[0]!.body).toEqual({ name: "Forgotten", description: "", public: false });
    expect(calls.slice(1).map((c) => (c.body as { uris: string[] }).uris.length)).toEqual([100, 50]);
  });

  test("add_to_playlist skips tracks the playlist already holds, reading every page of it", async () => {
    const entry = (n: number) => ({ added_at: null, item: { uri: `spotify:track:${id(n)}` } });
    const { call, calls } = spotifyMcp((c) => {
      if (c.method === "POST") return jsonResponse({ snapshot_id: "s" }, 201);
      const offset = Number(new URL(c.url).searchParams.get("offset"));
      return jsonResponse(offset === 0 ? { items: [entry(1)], next: "more", total: 2, offset, limit: 50 } : { items: [entry(2)], next: null, total: 2, offset, limit: 50 });
    });

    const result = await call("add_to_playlist", { playlist: `https://open.spotify.com/playlist/${id(9)}?si=x`, tracks: [id(1), id(2), id(3), `https://open.spotify.com/track/${id(4)}`] });

    expect(JSON.parse(result.text)).toEqual({ added: 2, alreadyInPlaylist: 2 });
    expect(calls.at(-1)!.body).toEqual({ uris: [`spotify:track:${id(3)}`, `spotify:track:${id(4)}`] });
  });

  test("a new playlist whose tracks fail to add still reports where it is", async () => {
    const { call } = spotifyMcp((c) => (c.url.endsWith("/me/playlists") ? jsonResponse({ id: "p1", external_urls: { spotify: "https://open.spotify.com/playlist/p1" } }, 201) : jsonResponse({ error: { status: 500, message: "Server error" } }, 500)));

    const result = await call("create_playlist", { name: "x", tracks: [id(1)] });

    expect(result).toEqual({ isError: true, text: "Created playlist https://open.spotify.com/playlist/p1 (id p1), but adding its tracks failed: Spotify API 500: Server error" });
  });

  test("a grant without the playlist scopes asks to re-authorize and calls nothing", async () => {
    const { call, calls } = spotifyMcp(() => undefined, "playlist-modify-private");

    const result = await call("create_playlist", { name: "x" });

    expect(result).toEqual({ isError: true, text: "Re-authorize Encore to grant playlist-modify-public: connect Spotify again in encore Settings." });
    expect(calls).toEqual([]);
  });

  test("something that is not a track is refused before any call", async () => {
    const { call, calls } = spotifyMcp(() => undefined);

    const result = await call("add_to_playlist", { playlist: id(9), tracks: ["spotify:album:" + id(1)] });

    expect(result).toEqual({ isError: true, text: `Not Spotify tracks: spotify:album:${id(1)}` });
    expect(calls).toEqual([]);
  });
});

describe("mcp playback controls", () => {
  test("each control sends its command, to the given device when one is passed", async () => {
    const { call, calls } = spotifyMcp(() => noContent());

    for (const name of ["pause", "resume", "skip_next"]) await call(name);
    await call("skip_previous", { device_id: "dev 1" });

    expect(writes(calls)).toEqual(["PUT /v1/me/player/pause", "PUT /v1/me/player/play", "POST /v1/me/player/next", "POST /v1/me/player/previous?device_id=dev%201"]);
  });

  test("no active device and a free account each get a message saying what to do", async () => {
    const reasons = ["NO_ACTIVE_DEVICE", "PREMIUM_REQUIRED"];
    const { call } = spotifyMcp(() => jsonResponse({ error: { status: 403, message: "Player command failed", reason: reasons.shift() } }, reasons.length === 2 ? 404 : 403));

    const results = [await call("pause"), await call("skip_next")];

    expect(results).toEqual([
      { isError: true, text: "No active Spotify device. Open Spotify on a phone, computer or speaker and play something there, or pass device_id from the devices tool." },
      { isError: true, text: "Spotify Premium is required to control playback." },
    ]);
  });

  test("devices lists each device and which one is active", async () => {
    const { call } = spotifyMcp(() => jsonResponse({ devices: [{ id: "d1", is_active: true, is_restricted: false, name: "Phone", type: "Smartphone", volume_percent: 60 }] }));

    const result = await call("devices");

    expect(JSON.parse(result.text)).toEqual({ devices: [{ id: "d1", name: "Phone", type: "Smartphone", active: true, restricted: false, volume: 60 }] });
  });
});

describe("mcp release tools", () => {
  function withReleases() {
    const mcp = spotifyMcp(() => undefined);
    for (const [n, day] of [[1, "2099-01-02"], [2, "2099-01-01"]] as const)
      mcp.db.insert(releases).values({ id: id(n), uri: `spotify:album:${id(n)}`, artistId: "a", artistName: "A", name: `R${n}`, albumType: "single", releaseDate: day, firstSeenAt: 0, isNew: true }).run();
    const listed = async (args: Record<string, unknown> = {}) => (JSON.parse((await mcp.call("releases", args)).text) as { id: string }[]).map((r) => r.id);
    return { ...mcp, listed };
  }

  test("mark_release_seen takes album links and hides those releases unless includeSeen is set", async () => {
    const { call, listed } = withReleases();

    const marked = await call("mark_release_seen", { ids: [`https://open.spotify.com/album/${id(1)}`] });

    expect(JSON.parse(marked.text)).toEqual({ marked: 1 });
    expect([await listed(), await listed({ includeSeen: true })]).toEqual([[id(2)], [id(1), id(2)]]);
  });

  test("mark_release_seen with all marks every unseen release, and needs ids or all", async () => {
    const { call, listed } = withReleases();

    const results = [await call("mark_release_seen", {}), await call("mark_release_seen", { all: true })];

    expect(results).toEqual([{ isError: true, text: "Pass either ids or all: true." }, { isError: false, text: JSON.stringify({ marked: 2 }) }]);
    expect(await listed({ status: "recent", days: 365 })).toEqual([]);
  });
});
