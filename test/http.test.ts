import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { play, seed, testApp, track, uri } from "./helpers";

function signedIn() {
  const app = testApp();
  const cookie = `encore_session=${createSession(app.db)}`;
  const get = (path: string) => app.request(path, { headers: { cookie } });
  return { ...app, cookie, get };
}

const exportRow = {
  ts: "2026-01-05T10:00:00Z",
  platform: "ios",
  ms_played: 200000,
  conn_country: "KW",
  ip_addr: "198.51.100.1",
  master_metadata_track_name: "Song A",
  master_metadata_album_artist_name: "Artist X",
  master_metadata_album_album_name: "Album 1",
  spotify_track_uri: uri("a1"),
  reason_start: "clickrow",
  reason_end: "trackdone",
  shuffle: false,
  skipped: false,
  offline: false,
  incognito_mode: false,
};

describe("http", () => {
  test("multipart import, then stats over HTTP", async () => {
    const { app, cookie, get } = signedIn();
    const form = new FormData();
    form.append("files", new File([JSON.stringify([exportRow])], "Streaming_History_Audio_2026.json"));
    form.append("files", new File(["%PDF"], "ReadMeFirst_ExtendedStreamingHistory.pdf"));
    const res = await app.request("/api/import", { method: "POST", body: form, headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inserted: 1, ignoredFiles: ["ReadMeFirst_ExtendedStreamingHistory.pdf"] });
    expect(await (await get("/api/stats/overview")).json()).toMatchObject({ plays: 1, listens: 1 });
    expect((await (await get("/api/status")).json()) as object).toMatchObject({ timezone: "Asia/Kuwait", import: { result: { inserted: 1 } }, spotify: { connected: false }, plays: { plays: 1, music: 1, api: 0, live: 0 } });
  });

  test("bad uploads are rejected", async () => {
    const { app, cookie } = signedIn();
    const form = new FormData();
    form.append("files", new File(["{}"], "Streaming_History_Audio_2026.json"));
    const res = await app.request("/api/import", { method: "POST", body: form, headers: { cookie } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_export");
    expect((await app.request("/api/import", { method: "POST", body: "x", headers: { cookie } })).status).toBe(415);
  });

  test("query validation and not-found entities", async () => {
    const { get } = signedIn();
    expect((await get("/api/stats/overview?from=2026-1-1")).status).toBe(400);
    expect((await get("/api/stats/overview?from=2026-02-01&to=2026-01-01")).status).toBe(400);
    expect((await get("/api/stats/top/tracks?limit=0")).status).toBe(400);
    expect((await get("/api/stats/timeseries?period=hour")).status).toBe(400);
    expect((await get("/api/entities/track")).status).toBe(400);
    expect((await get(`/api/entities/track?uri=${uri("zz")}`)).status).toBe(404);
    expect((await get("/api/stats/skips/split?class=meh")).status).toBe(400);
    expect((await get("/api/history?outcome=skipped")).status).toBe(400);
    expect((await get("/api/search")).status).toBe(400);
    expect(await (await get("/api/search?q=x")).json()).toEqual({ artists: [], songs: [], albums: [] });
    for (const path of ["/api/stats/clock", "/api/stats/eras", "/api/stats/trips", "/api/stats/on-this-day", "/api/stats/forgotten", "/api/stats/devices", "/api/stats/tags/genres", "/api/history?outcome=early,midway"]) {
      expect((await get(path)).status).toBe(200);
    }
  });

  test("history filters by outcome", async () => {
    const { db, get } = signedIn();
    seed(db, [track("a", "A", "Artist", null, { durationMs: 200_000 })], [play("2026-01-01T10:00:00Z", uri("a"), 5_000, { skipped: true }), play("2026-01-01T11:00:00Z", uri("a"), 200_000)]);

    const body = (await (await get("/api/history?outcome=early,midway")).json()) as { total: number; items: { outcome: string }[] };

    expect(body).toMatchObject({ total: 1, items: [{ outcome: "early" }] });
  });

  test("Spotify authorize URL uses PKCE and the callback rejects unknown state", async () => {
    const { get, app } = signedIn();
    const { url } = (await (await get("/api/spotify/authorize")).json()) as { url: string };
    const params = new URL(url).searchParams;
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("redirect_uri")).toBe("http://localhost:8888/callback");
    expect(params.get("scope")).toContain("user-modify-playback-state");
    const res = await app.request("/callback?code=abc&state=forged");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:8888/settings/spotify?spotify=error");
  });

  test("the Spotify callback returns to where the flow started, from a fixed list", async () => {
    const { get, app } = signedIn();
    const { url } = (await (await get("/api/spotify/authorize?return=setup")).json()) as { url: string };
    expect(new URL(url).searchParams.get("state")).toStartWith("setup.");
    expect((await get("/api/spotify/authorize?return=https://evil.example")).status).toBe(400);
    const location = async (query: string) => (await app.request(`/callback?${query}`)).headers.get("location");
    expect(await location("code=abc&state=setup.forged")).toBe("http://localhost:8888/setup?step=spotifyConnect&spotify=error");
    expect(await location("error=access_denied&state=setup.x")).toBe("http://localhost:8888/setup?step=spotifyConnect&spotify=denied");
    expect(await location("error=access_denied&state=settings.x")).toBe("http://localhost:8888/settings/spotify?spotify=denied");
    for (const state of ["__proto__.x", "constructor.x", "https://evil.example.x", "//evil.example"])
      expect(await location(`error=access_denied&state=${encodeURIComponent(state)}`)).toBe("http://localhost:8888/settings/spotify?spotify=denied");
  });
});
