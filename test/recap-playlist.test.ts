import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createSession } from "../src/auth/sessions";
import { livingPlaylists, livingRefreshes, recapPlaylists, spotifyAuth } from "../src/db/schema";
import { EmptyRecapPlaylistError, recapPlaylistIds, saveRecapPlaylist } from "../src/digest/playlist";
import { RecapPeriodError, recapPeriod } from "../src/digest/service";
import { definingSongs } from "../src/digest/songs";
import { setJobState } from "../src/jobs/state";
import { thisYearTracks } from "../src/living/build";
import { livingRow, MissingScopeError, refreshLiving, setLivingEnabled, type LivingDeps } from "../src/living/refresh";
import { isDue, nextRefreshDay } from "../src/living/schedule";
import { SpotifyNotConnectedError } from "../src/spotify/errors";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { jsonResponse, noContent, play, routeFetch, seed, testApp, testConfig, testDb, testSettings, track, TZ, uri, type FetchCall } from "./helpers";

const ALL_SCOPES = "playlist-modify-private ugc-image-upload";
const NOV_14 = Date.parse("2026-11-14T09:00:00Z");
const listensOn = (id: string, n: number, day: string, ms = 200_000) => Array.from({ length: n }, (_, i) => play(`${day}T1${i % 10}:00:00Z`, uri(id), ms));
const skipsOn = (id: string, n: number, day: string) => Array.from({ length: n }, (_, i) => play(`${day}T0${i % 10}:00:00Z`, uri(id), 4_000, { skipped: true, reasonEnd: "fwdbtn" }));

type Route = (call: FetchCall) => Response | undefined;

function setup(opts: { scope?: string | null; route?: Route; now?: () => number } = {}) {
  const db = testDb();
  const config = testConfig();
  const settings = testSettings(db, config);
  if (opts.scope !== null)
    db.insert(spotifyAuth)
      .values({ id: 1, accessToken: "tok", refreshToken: "ref", expiresAt: 9e15, scope: opts.scope ?? ALL_SCOPES, spotifyUserId: "owner", clientId: "test-client", updatedAt: 0 })
      .run();
  let created = 0;
  const { fn, calls } = routeFetch((call) => {
    const custom = opts.route?.(call);
    if (custom) return custom;
    if (call.method === "POST" && call.url.endsWith("/me/playlists")) {
      created++;
      return jsonResponse({ id: `pl${created}`, external_urls: { spotify: `https://open.spotify.com/playlist/pl${created}` } }, 201);
    }
    if (call.method === "PUT" && call.url.includes("/playlists/")) return call.url.endsWith("/items") ? jsonResponse({ snapshot_id: "s" }) : noContent();
    return undefined;
  });
  let clock = opts.now ?? (() => NOV_14);
  const now = () => clock();
  const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, settings, fn, now), settings, fn, now);
  const deps: LivingDeps = { db, spotify, settings, now };
  const sent = () => calls.map((c) => `${c.method} ${new URL(c.url).pathname.replace("/v1", "")}`);
  const setNow = (ts: number) => (clock = () => ts);
  return { db, deps, calls, sent, setNow, spotify };
}

/** October 2026: four songs, one with listens on one day only, one with a single listen, one only skipped. */
function seedOctober(db: LivingDeps["db"]) {
  seed(
    db,
    [track("a", "A", "X", null), track("b", "B", "X", null), track("c", "C", "X", null), track("d", "D", "X", null), track("s", "S", "X", null)],
    [...listensOn("a", 5, "2026-10-03"), ...listensOn("b", 5, "2026-10-04", 100_000), ...listensOn("c", 3, "2026-10-05"), ...listensOn("d", 1, "2026-10-06"), ...skipsOn("s", 9, "2026-10-07")],
  );
}

describe("the songs that defined a period", () => {
  test("most listens first, then most time; a song needs two listens and skips never count", () => {
    const { db } = setup();
    seedOctober(db);

    expect(definingSongs(db, "monthly", { from: "2026-10-01", to: "2026-10-31" }).map((s) => s.name)).toEqual(["A", "B", "C"]);
  });
});

describe("saving a recap playlist", () => {
  test("the first save makes one private playlist named after the period, fills it and uploads the cover", async () => {
    const { db, deps, sent, calls } = setup();
    seedOctober(db);

    const saved = await saveRecapPlaylist({ ...deps, today: "2026-11-14" }, "monthly", "2026-10");

    expect(sent()).toEqual(["POST /me/playlists", "PUT /playlists/pl1/items", "PUT /playlists/pl1/images"]);
    expect(calls[0]!.body).toEqual({ name: "October 2026", description: "The songs that defined October 2026, from your encore recap.", public: false });
    expect(calls[1]!.body).toEqual({ uris: [uri("a"), uri("b"), uri("c")] });
    expect([saved.tracks, saved.cover.status, recapPlaylistIds(db)]).toEqual([3, "uploaded", ["pl1"]]);
  });

  test("saving again updates the same playlist in place and leaves the cover alone", async () => {
    const { db, deps, sent } = setup();
    seedOctober(db);
    await saveRecapPlaylist({ ...deps, today: "2026-11-14" }, "monthly", "2026-10");

    const again = await saveRecapPlaylist({ ...deps, today: "2026-11-14" }, "monthly", "2026-10");

    expect(sent().slice(3)).toEqual(["PUT /playlists/pl1", "PUT /playlists/pl1/items"]);
    expect([again.playlistId, again.cover.status]).toEqual(["pl1", "unchanged"]);
  });

  test("a playlist deleted in Spotify is made again", async () => {
    let gone = false;
    const { db, deps, sent } = setup({ route: (c) => (gone && c.method === "PUT" && c.url.endsWith("/playlists/pl1") ? jsonResponse({ error: { status: 404, message: "Not found" } }, 404) : undefined) });
    seedOctober(db);
    await saveRecapPlaylist({ ...deps, today: "2026-11-14" }, "monthly", "2026-10");
    gone = true;

    const again = await saveRecapPlaylist({ ...deps, today: "2026-11-14" }, "monthly", "2026-10");

    expect(again.playlistId).toBe("pl2");
    expect(sent().slice(3, 5)).toEqual(["PUT /playlists/pl1", "POST /me/playlists"]);
  });

  test("a period still going, a period with no song played twice, no Spotify and no playlist access are refused before any call", async () => {
    const connected = setup();
    seedOctober(connected.db);
    const save = (s: ReturnType<typeof setup>, key: string, today = "2026-11-14") => saveRecapPlaylist({ ...s.deps, today }, "monthly", key);

    await expect(save(connected, "2026-11")).rejects.toBeInstanceOf(RecapPeriodError);
    await expect(save(connected, "2026-09")).rejects.toBeInstanceOf(EmptyRecapPlaylistError);
    const offline = setup({ scope: null });
    seedOctober(offline.db);
    await expect(save(offline, "2026-10")).rejects.toBeInstanceOf(SpotifyNotConnectedError);
    const readOnly = setup({ scope: "user-read-recently-played" });
    seedOctober(readOnly.db);
    await expect(save(readOnly, "2026-10")).rejects.toBeInstanceOf(MissingScopeError);
    expect([connected.calls.length, offline.calls.length, readOnly.calls.length]).toEqual([0, 0, 0]);
  });

  test("the period view says how many songs the playlist holds and whether it is in Spotify", async () => {
    const { db, deps } = setup();
    seedOctober(db);
    const before = recapPeriod(db, "monthly", "2026-10", "2026-11-14").playlist;
    await saveRecapPlaylist({ ...deps, today: "2026-11-14" }, "monthly", "2026-10");

    const after = recapPeriod(db, "monthly", "2026-10", "2026-11-14").playlist;

    expect([before?.songs, before?.canSave, before?.saved, after?.saved?.url, after?.saved?.source]).toEqual([3, true, null, "https://open.spotify.com/playlist/pl1", "recap"]);
    expect(recapPeriod(db, "yearly", "2026", "2026-11-14").playlist?.canSave).toBe(false);
  });
});

describe("This year so far", () => {
  const DEC_20 = Date.parse("2026-12-20T09:00:00Z");
  const JAN_2 = Date.parse("2027-01-02T09:00:00Z");

  function seedYear(db: LivingDeps["db"]) {
    seed(db, [track("a", "A", "X", null), track("b", "B", "X", null), track("z", "Z", "X", null)], [...listensOn("a", 4, "2026-03-01"), ...listensOn("b", 3, "2026-12-01"), ...listensOn("z", 6, "2025-06-01")]);
  }

  test("holds the year's songs by the recap playlist rule, this year only", () => {
    const { db } = setup();
    seedYear(db);

    expect(thisYearTracks(db, { now: DEC_20, timezone: TZ }, 50).map((t) => t.name)).toEqual(["A", "B"]);
  });

  test("makes no playlist while the year has no song played twice", async () => {
    const { deps, sent } = setup({ now: () => JAN_2 });

    const outcome = await setLivingEnabled(deps, "this-year", true);

    expect([outcome.status, sent()]).toEqual(["empty", []]);
  });

  test("is due each week and again as soon as the year turns", () => {
    const { db, deps } = setup({ now: () => DEC_20 });
    const row = { ...livingRow(db, "this-year", DEC_20), enabled: true, playlistId: "pl1", checkedAt: Date.parse("2026-12-31T08:00:00Z") };

    expect([isDue("yearly-weekly", row, Date.parse("2026-12-31T20:00:00Z"), TZ), isDue("yearly-weekly", row, JAN_2, TZ)]).toEqual([false, true]);
    expect(nextRefreshDay("yearly-weekly", row.checkedAt, deps.now(), TZ)).toBe("2027-01-01");
  });

  test("at the turn of the year it becomes that year's playlist, and a new one starts once the new year has songs", async () => {
    const { db, deps, sent, calls, setNow } = setup({ now: () => DEC_20 });
    seedYear(db);
    await setLivingEnabled(deps, "this-year", true);
    seed(db, [track("c", "C", "X", null), track("n", "N", "X", null)], [...listensOn("c", 5, "2026-12-25"), ...listensOn("n", 2, "2027-01-01")]);
    setNow(JAN_2);
    const before = calls.length;

    const outcome = await refreshLiving(deps, "this-year", "schedule");

    expect(sent().slice(before)).toEqual(["PUT /playlists/pl1", "PUT /playlists/pl1/items", "PUT /playlists/pl1/images", "POST /me/playlists", "PUT /playlists/pl2/items", "PUT /playlists/pl2/images"]);
    expect(calls[before]!.body).toEqual({ name: "2026", description: "The songs that defined 2026, from your encore recap." });
    expect(calls[before + 1]!.body).toEqual({ uris: [uri("c"), uri("a"), uri("b")] });
    expect(calls[before + 4]!.body).toEqual({ uris: [uri("n")] });
    expect(db.select().from(recapPlaylists).all().map((r) => [r.kind, r.periodKey, r.playlistId, r.source])).toEqual([["yearly", "2026", "pl1", "living"]]);
    expect(db.select({ trigger: livingRefreshes.trigger, playlistId: livingRefreshes.playlistId }).from(livingRefreshes).all()).toEqual([
      { trigger: "enable", playlistId: "pl1" },
      { trigger: "year-end", playlistId: "pl1" },
      { trigger: "schedule", playlistId: "pl2" },
    ]);
    expect([outcome.status, livingRow(db, "this-year", JAN_2).playlistId]).toEqual(["refreshed", "pl2"]);
  });

  test("the year is not closed while its playlist is playing", async () => {
    const { db, deps, sent, calls, setNow } = setup({ now: () => DEC_20 });
    seedYear(db);
    await setLivingEnabled(deps, "this-year", true);
    setNow(JAN_2);
    setJobState(db, "watch", { data: { current: { contextUri: "spotify:playlist:pl1", lastSeenAt: JAN_2 - 10_000, wasPlaying: true } } });
    const before = calls.length;

    const outcome = await refreshLiving(deps, "this-year", "schedule");

    expect([outcome.status, sent().length - before, db.select().from(recapPlaylists).all().length]).toEqual(["deferred", 0, 0]);
  });

  test("a year saved from its recap keeps its own playlist; this one carries on into the new year", async () => {
    const { db, deps, setNow } = setup({ now: () => DEC_20 });
    seedYear(db);
    await setLivingEnabled(deps, "this-year", true);
    db.insert(recapPlaylists).values({ kind: "yearly", periodKey: "2026", playlistId: "own", playlistUrl: "https://open.spotify.com/playlist/own", source: "recap", coverUploadKey: null, savedAt: 0 }).run();
    seed(db, [track("n", "N", "X", null)], listensOn("n", 2, "2027-01-01"));
    setNow(JAN_2);

    await refreshLiving(deps, "this-year", "schedule");

    expect(db.select({ playlistId: livingPlaylists.playlistId }).from(livingPlaylists).where(eq(livingPlaylists.kind, "this-year")).get()?.playlistId).toBe("pl1");
    expect(db.select().from(recapPlaylists).all().map((r) => r.playlistId)).toEqual(["own"]);
  });
});

describe("HTTP", () => {
  test("saving a recap playlist without Spotify answers 409, and a period still going cannot be saved", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;
    seed(app.db, [track("a", "A", "X", null)], listensOn("a", 3, "2026-01-05"));
    const headers = { cookie, origin: "http://localhost:8888" };

    const notConnected = await app.request("/api/digests/periods/monthly/2026-01/playlist", { method: "POST", headers });
    const future = await app.request("/api/digests/periods/yearly/2999/playlist", { method: "POST", headers });

    expect([notConnected.status, ((await notConnected.json()) as { error: { code: string } }).error.code]).toEqual([409, "spotify_not_connected"]);
    expect(future.status).toBe(409);
  });

  test("serves the period's cover, cached for good at its versioned URL", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;
    seed(app.db, [track("a", "A", "X", null)], listensOn("a", 3, "2026-01-05"));
    const period = (await (await app.request("/api/digests/periods/monthly/2026-01", { headers: { cookie } })).json()) as { playlist: { coverUrl: string } };

    const res = await app.request(period.playlist.coverUrl, { headers: { cookie } });

    expect([res.status, res.headers.get("content-type"), res.headers.get("cache-control")]).toEqual([200, "image/jpeg", "private, max-age=31536000, immutable"]);
  });
});
