import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { connectSpotify, jsonResponse, noContent, routeFetch, testApp, uri, type FetchCall } from "./helpers";

const noDevice = () => jsonResponse({ error: { status: 404, message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" } }, 404);

function signedIn(respond: (call: FetchCall) => Response | undefined) {
  const { fn, calls } = routeFetch(respond);
  const app = testApp({}, fn);
  connectSpotify(app.db);
  const cookie = `encore_session=${createSession(app.db)}`;
  const get = (path: string) => app.request(path, { headers: { cookie } });
  const post = (path: string, json?: unknown) => app.request(path, json === undefined ? { method: "POST", headers: { cookie } } : { json, headers: { cookie } });
  return { ...app, calls, get, post };
}

describe("player endpoints", () => {
  test("every control returns 409 no_active_device when nothing is active", async () => {
    const { post } = signedIn(noDevice);
    for (const [path, body] of [
      ["/api/player/play", { uris: [uri("a")] }],
      ["/api/player/pause", undefined],
      ["/api/player/next", undefined],
      ["/api/player/queue", { uri: uri("a") }],
      ["/api/player/shuffle", { state: false }],
    ] as const) {
      const res = await post(path, body);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("no_active_device");
    }
  });

  test("controls send the documented Spotify requests", async () => {
    const { post, calls } = signedIn(() => noContent());
    expect((await post("/api/player/play", { contextUri: "spotify:album:4aawyAB9vmqN3uQ7FjRGTy", offset: { position: 2 }, deviceId: "d1" })).status).toBe(200);
    expect((await post("/api/player/transfer", { deviceId: "d2" })).status).toBe(200);
    expect(calls.map((c) => [c.method, c.url.replace("https://api.spotify.com/v1", ""), c.body])).toEqual([
      ["PUT", "/me/player/play?device_id=d1", { context_uri: "spotify:album:4aawyAB9vmqN3uQ7FjRGTy", offset: { position: 2 } }],
      ["PUT", "/me/player", { device_ids: ["d2"], play: false }],
    ]);
  });

  test("a control succeeds when Spotify answers 200 with a body that is not JSON", async () => {
    const { post } = signedIn(() => new Response("sL1_y8Fj0w3B6swawYiW1EWKYLw", { status: 200, headers: { "content-type": "application/json" } }));
    for (const path of ["/api/player/pause", "/api/player/next"]) expect((await post(path)).status).toBe(200);
    expect((await post("/api/player/play", { uris: [uri("a")] })).status).toBe(200);
  });

  test("an unreadable body on a read is a Spotify failure, not an internal error", async () => {
    const { get } = signedIn(() => new Response("not json", { status: 200 }));
    const res = await get("/api/player/devices");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("spotify_failed");
  });

  test("invalid bodies are 400 and make no Spotify call", async () => {
    const { post, calls } = signedIn(() => noContent());
    expect((await post("/api/player/queue", { uri: "spotify:episode:x" })).status).toBe(400);
    expect((await post("/api/player/play", { contextUri: "spotify:album:4aawyAB9vmqN3uQ7FjRGTy", uris: [uri("a")] })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("now playing reports nothing playing on a 204", async () => {
    const { get } = signedIn(() => noContent());
    expect(await (await get("/api/player/now")).json()).toMatchObject({ playing: false, track: null });
  });

  test("a paused Spotify gate is a 503 with the reason", async () => {
    const { post } = signedIn(() => jsonResponse({ error: { status: 429, message: "x", reason: "QUOTA_EXCEEDED" } }, 429));
    const res = await post("/api/player/next");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string; details: { reason: string } } }).error).toMatchObject({ code: "spotify_paused", details: { reason: "quota_exceeded" } });
  });
});

describe("dj and radar endpoints", () => {
  test("dj start validates URIs, stop without a session is 404", async () => {
    const { post, get } = signedIn(() => noContent());
    expect((await post("/api/dj/start", { uris: ["spotify:track:short"] })).status).toBe(400);
    expect((await post("/api/dj/stop")).status).toBe(404);
    expect(await (await get("/api/dj")).json()).toEqual({ session: null });
  });

  test("radar lists nothing before the first run", async () => {
    const { get } = signedIn(() => undefined);
    expect(await (await get("/api/radar")).json()).toMatchObject({ artists: 0, unseenNew: 0, items: [], lastRunAt: null });
  });
});
