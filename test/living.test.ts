import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { livingPlaylists, livingRefreshes, picks, releases, spotifyAuth, type LivingTrack } from "../src/db/schema";
import { createJobs, enabledJobs } from "../src/jobs/definitions";
import { setJobState } from "../src/jobs/state";
import { forgottenTracks, mostPlayedTracks, newReleaseTracks, picksTracks, replaceMerge, rollingMerge, thisMonthTracks } from "../src/living/build";
import { LIVING } from "../src/living/kinds";
import { livingList } from "../src/living/view";
import { fetchReleaseTracks, livingRow, markRemovedPlaylists, MissingScopeError, refreshLiving, refreshPicksPlaylist, runLiving, setLivingEnabled, type LivingDeps } from "../src/living/refresh";
import { isDue, nextRefreshDay, type LivingRow } from "../src/living/schedule";
import { songKey } from "../src/plays/song";
import { createServices } from "../src/services";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { jsonResponse, noContent, play, routeFetch, seed, testApp, testConfig, testDb, testSettings, track, TZ, uri, type FetchCall } from "./helpers";

const NOW = Date.parse("2026-11-14T09:00:00Z");
const DAY = 86_400_000;
const ALL_SCOPES = "playlist-modify-private ugc-image-upload";
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();
const listens = (id: string, n: number, daysAgo: number) => Array.from({ length: n }, (_, i) => play(at(daysAgo + i * 0.01), uri(id), 200_000));
const skips = (id: string, n: number, daysAgo: number) => Array.from({ length: n }, (_, i) => play(at(daysAgo + i * 0.01), uri(id), 4_000, { skipped: true, reasonEnd: "fwdbtn" }));
const t = (id: string): LivingTrack => ({ uri: uri(id), songKey: id, name: id, artist: "A", album: null, albumArtUrl: null });
const keys = (items: { songKey: string }[]) => items.map((i) => i.songKey);
const names = (items: { name: string }[]) => items.map((i) => i.name);

type Route = (call: FetchCall) => Response | undefined;

function setup(opts: { scope?: string; route?: Route; now?: () => number } = {}) {
  const db = testDb();
  const config = testConfig();
  const settings = testSettings(db, config);
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
  const now = opts.now ?? (() => NOW);
  const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, settings, fn, now), settings, fn, now);
  const deps: LivingDeps = { db, spotify, settings, now };
  const sent = () => calls.map((c) => `${c.method} ${new URL(c.url).pathname.replace("/v1", "")}`);
  return { db, deps, calls, sent };
}

let pickPosition = 0;
function insertPicks(db: LivingDeps["db"], week: string, songs: { id: string; state?: "new" | "never" }[]) {
  for (const s of songs) {
    db.insert(picks)
      .values({ week, position: ++pickPosition, uri: uri(s.id), songKey: songKey(s.id, "P"), name: s.id, artist: "P", reason: "r", distance: "near", state: s.state ?? "new", stateAt: 0, createdAt: 0 })
      .run();
  }
}

describe("builders", () => {
  test("Most played lately ranks by listens over the last four weeks and needs two listens", () => {
    const { db } = setup();
    seed(db, [track("a", "A", "X", null), track("b", "B", "X", null), track("c", "C", "X", null), track("d", "D", "X", null)], [...listens("a", 3, 1), ...listens("b", 5, 2), ...listens("c", 1, 1), ...listens("d", 9, 40)]);

    const built = mostPlayedTracks(db, { now: NOW, timezone: TZ });

    expect(names(built)).toEqual(["B", "A"]);
  });

  test("skips alone never move a song down Most played lately", () => {
    const { db } = setup();
    seed(db, [track("a", "A", "X", null), track("b", "B", "X", null)], [...listens("a", 4, 1), ...listens("b", 3, 1)]);
    const before = names(mostPlayedTracks(db, { now: NOW, timezone: TZ }));

    seed(db, [], skips("a", 20, 0.5));

    expect(names(mostPlayedTracks(db, { now: NOW, timezone: TZ }))).toEqual(before);
  });

  test("Forgotten favourites are songs with many listens and none in 90 days", () => {
    const { db } = setup();
    seed(db, [track("old", "Old", "X", null), track("kept", "Kept", "X", null), track("few", "Few", "X", null)], [...listens("old", 12, 200), ...listens("kept", 12, 200), ...listens("kept", 1, 5), ...listens("few", 3, 200)]);

    expect(names(forgottenTracks(db, { now: NOW, timezone: TZ }))).toEqual(["Old"]);
  });

  test("This month in past years takes this calendar month of earlier years only", () => {
    const { db } = setup();
    seed(
      db,
      [track("y1", "Last November", "X", null), track("y0", "This November", "X", null), track("oct", "Last October", "X", null)],
      [play("2025-11-20T10:00:00Z", uri("y1"), 200_000), play("2026-11-02T10:00:00Z", uri("y0"), 200_000), play("2025-10-20T10:00:00Z", uri("oct"), 200_000)],
    );

    expect(names(thisMonthTracks(db, { now: NOW, timezone: TZ }))).toEqual(["Last November"]);
  });

  test("This month in past years is empty with no earlier year", () => {
    const { db } = setup();
    seed(db, [track("y0", "This November", "X", null)], [play("2026-11-02T10:00:00Z", uri("y0"), 200_000)]);

    expect(thisMonthTracks(db, { now: NOW, timezone: TZ })).toEqual([]);
  });

  test("Weekly picks are the latest week in order, without never picks", () => {
    const { db } = setup();
    insertPicks(db, "2026-11-02", [{ id: "older" }]);
    insertPicks(db, "2026-11-09", [{ id: "one" }, { id: "no", state: "never" }, { id: "two" }]);

    expect(names(picksTracks(db))).toEqual(["one", "two"]);
  });

  test("New from your artists takes stored tracks of recent new releases, newest release first", async () => {
    const { db, deps } = setup({
      route: (call) => {
        const id = call.url.match(/albums\/(\w+)\/tracks/)?.[1];
        return id ? jsonResponse({ items: [1, 2, 3].map((n) => ({ id: `${id}${n}`, uri: uri(`${id}${n}`), name: `${id} ${n}`, track_number: n, artists: [{ id: "x", name: "X" }] })), total: 9, next: null, offset: 0, limit: 3 }) : undefined;
      },
    });
    const release = (id: string, releaseDate: string, isNew: boolean) =>
      db.insert(releases).values({ id, uri: `spotify:album:${id}`, artistId: "x", artistName: "X", name: id, albumType: "single", releaseDate, firstSeenAt: NOW, isNew }).run();
    release("early", "2026-10-20", true);
    release("late", "2026-11-10", true);
    release("ancient", "2025-01-01", true);
    release("known", "2026-11-11", false);

    const fetched = await fetchReleaseTracks(deps);

    expect(fetched).toEqual({ releases: 2, calls: 2 });
    expect(names(newReleaseTracks(db, { now: NOW, timezone: TZ }))).toEqual(["late 1", "late 2", "late 3", "early 1", "early 2", "early 3"]);
  });
});

describe("merging", () => {
  test("replace keeps the first distinct songs up to the cap", () => {
    expect(keys(replaceMerge([t("a"), t("b"), t("a"), t("c")], 2))).toEqual(["a", "b"]);
  });

  test("rolling fills an empty playlist to the cap", () => {
    expect(keys(rollingMerge([], [t("a"), t("b"), t("c")], { cap: 2, perRefresh: 1, placed: new Set() }))).toEqual(["a", "b"]);
  });

  test("rolling puts new songs on top and drops the oldest at the cap", () => {
    const merged = rollingMerge([t("a"), t("b"), t("c")], [t("a"), t("d"), t("e"), t("f")], { cap: 4, perRefresh: 2, placed: new Set(["a", "b", "c"]) });

    expect(keys(merged)).toEqual(["d", "e", "a", "b"]);
  });

  test("rolling never adds a song the playlist already had", () => {
    const merged = rollingMerge([t("b")], [t("a"), t("b"), t("c")], { cap: 5, perRefresh: 5, placed: new Set(["a", "b"]) });

    expect(keys(merged)).toEqual(["c", "b"]);
  });
});

describe("refresh", () => {
  function withPicks(opts: Parameters<typeof setup>[0] = {}) {
    const s = setup(opts);
    insertPicks(s.db, "2026-11-09", [{ id: "one" }, { id: "two" }]);
    return s;
  }

  test("switching on makes one private playlist, fills it and uploads the cover", async () => {
    const { deps, sent, calls } = withPicks();

    const outcome = await setLivingEnabled(deps, "picks", true);

    expect(outcome).toEqual({ kind: "picks", status: "refreshed", calls: 3, cover: "uploaded" });
    expect(sent()).toEqual(["POST /me/playlists", "PUT /playlists/pl1/items", "PUT /playlists/pl1/images"]);
    expect(calls[0]!.body).toMatchObject({ name: "Weekly picks", public: false, description: "This week's new songs picked for you. Updated 14 Nov 2026 by encore." });
  });

  test("a later change updates the same playlist in place with two calls and no cover upload", async () => {
    const { db, deps, sent } = withPicks();
    await setLivingEnabled(deps, "picks", true);
    insertPicks(db, "2026-11-16", [{ id: "three" }]);

    await refreshLiving(deps, "picks", "picks");

    expect(sent().slice(3)).toEqual(["PUT /playlists/pl1", "PUT /playlists/pl1/items"]);
  });

  test("each change is recorded with what it added and removed", async () => {
    const { db, deps } = withPicks();
    await setLivingEnabled(deps, "picks", true);
    insertPicks(db, "2026-11-16", [{ id: "three" }]);

    await refreshLiving(deps, "picks", "manual");

    const last = db.select().from(livingRefreshes).all().at(-1)!;
    expect([last.trigger, names(last.added), names(last.removed), names(last.items)]).toEqual(["manual", ["three"], ["one", "two"], ["three"]]);
  });

  test("the same contents cost no call", async () => {
    const { deps, sent } = withPicks();
    await setLivingEnabled(deps, "picks", true);

    const outcome = await refreshLiving(deps, "picks", "schedule");

    expect([outcome.status, sent().length]).toEqual(["unchanged", 3]);
  });

  test("a refresh waits while the playlist is the playback context", async () => {
    const { db, deps, sent } = withPicks();
    await setLivingEnabled(deps, "picks", true);
    insertPicks(db, "2026-11-16", [{ id: "three" }]);
    setJobState(db, "watch", { data: { current: { contextUri: "spotify:playlist:pl1", lastSeenAt: NOW - 10_000, wasPlaying: false } } });

    const outcome = await refreshLiving(deps, "picks", "schedule");

    expect([outcome.status, sent().length, isDue("picks", livingRow(db, "picks", NOW), NOW, TZ)]).toEqual(["deferred", 3, true]);
  });

  test("an empty list never replaces a filled playlist", async () => {
    const { db, deps, sent } = withPicks();
    await setLivingEnabled(deps, "picks", true);
    db.update(picks).set({ state: "never" }).run();

    const outcome = await refreshLiving(deps, "picks", "schedule");

    expect([outcome.status, sent().length]).toEqual(["empty", 3]);
  });

  test("a playlist deleted in Spotify is detected on the failed write and switched off", async () => {
    let gone = false;
    const { db, deps } = withPicks({ route: (call) => (gone && call.url.includes("/playlists/pl1") ? jsonResponse({ error: { status: 404, message: "Not found" } }, 404) : undefined) });
    await setLivingEnabled(deps, "picks", true);
    insertPicks(db, "2026-11-16", [{ id: "three" }]);
    gone = true;

    const outcome = await refreshLiving(deps, "picks", "schedule");

    expect([outcome.status, livingRow(db, "picks", NOW).enabled, livingRow(db, "picks", NOW).removedAt]).toEqual(["removed", false, NOW]);
  });

  test("switching on again after a deletion makes a new playlist", async () => {
    const { db, deps, sent } = withPicks();
    await setLivingEnabled(deps, "picks", true);
    markRemovedPlaylists(db, new Set(), NOW + 1, NOW);

    await setLivingEnabled(deps, "picks", true);

    expect([sent().filter((c) => c === "POST /me/playlists").length, livingRow(db, "picks", NOW).playlistId]).toEqual([2, "pl2"]);
  });

  test("a full library listing without the playlist marks it deleted, without a call", () => {
    const { db } = setup();
    db.insert(livingPlaylists).values({ kind: "forgotten", enabled: true, playlistId: "gone", playlistUrl: "u", createdAt: NOW - DAY, updatedAt: 0 }).run();
    db.insert(livingPlaylists).values({ kind: "picks", enabled: true, playlistId: "here", playlistUrl: "u", createdAt: NOW - DAY, updatedAt: 0 }).run();
    db.insert(livingPlaylists).values({ kind: "most-played", enabled: true, playlistId: "new", playlistUrl: "u", createdAt: NOW + 1, updatedAt: 0 }).run();

    const removed = markRemovedPlaylists(db, new Set(["here"]), NOW, NOW);

    expect(removed).toEqual(["forgotten"]);
  });

  test("switching on without playlist access is refused before any call", async () => {
    const { deps, calls } = withPicks({ scope: "ugc-image-upload" });

    await expect(setLivingEnabled(deps, "picks", true)).rejects.toBeInstanceOf(MissingScopeError);
    expect(calls).toHaveLength(0);
  });

  test("without the image scope the playlist is filled and the cover is left for later", async () => {
    const { deps, sent } = withPicks({ scope: "playlist-modify-private" });

    const outcome = await setLivingEnabled(deps, "picks", true);

    expect([outcome.cover, sent()]).toEqual(["missing_scope", ["POST /me/playlists", "PUT /playlists/pl1/items"]]);
  });

  test("switching off stops refreshes and makes no call", async () => {
    const { db, deps, sent } = withPicks();
    await setLivingEnabled(deps, "picks", true);
    await setLivingEnabled(deps, "picks", false);
    insertPicks(db, "2026-11-16", [{ id: "three" }]);

    const outcome = await refreshLiving(deps, "picks", "schedule");

    expect([outcome.status, sent().length]).toEqual(["off", 3]);
  });

  test("a Spotify failure is recorded and retried after an hour", async () => {
    const { db, deps } = withPicks({ route: (call) => (call.method === "POST" ? jsonResponse({ error: { status: 500, message: "boom" } }, 500) : undefined) });

    const outcome = await setLivingEnabled(deps, "picks", true);

    const row = livingRow(db, "picks", NOW);
    expect([outcome.status, row.error, isDue("picks", row, NOW + 30 * 60_000, TZ), isDue("picks", row, NOW + 61 * 60_000, TZ)]).toEqual(["failed", "Spotify API 500: boom", false, true]);
  });

  test("a song stays in a rolling playlist after it is skipped", async () => {
    let clock = NOW;
    const { db, deps } = setup({ now: () => clock });
    seed(db, [track("f", "Fav", "X", null)], listens("f", 12, 200));
    await setLivingEnabled(deps, "forgotten", true);
    seed(db, [], skips("f", 3, 0));
    clock = NOW + 7 * DAY;

    await refreshLiving(deps, "forgotten", "schedule");

    expect(names(db.select().from(livingRefreshes).all().at(-1)!.items)).toEqual(["Fav"]);
  });

  test("Weekly picks follow a picks change only while switched on", async () => {
    const { deps, calls } = withPicks();

    const outcome = await refreshPicksPlaylist(deps);

    expect([outcome, calls.length]).toEqual([null, 0]);
  });

  test("the old picks mirror is taken over instead of making a second playlist", async () => {
    const { db, deps, sent } = withPicks();
    setJobState(db, "picks_playlist", { data: { playlistId: "mirror", url: "https://open.spotify.com/playlist/mirror" } });

    await setLivingEnabled(deps, "picks", true);

    expect(sent()).toEqual(["PUT /playlists/mirror", "PUT /playlists/mirror/items", "PUT /playlists/mirror/images"]);
  });
});

describe("schedule", () => {
  const row = (patch: Partial<LivingRow>): LivingRow => ({
    kind: "most-played",
    enabled: true,
    playlistId: "pl",
    playlistUrl: "u",
    createdAt: 0,
    removedAt: null,
    coverUploadKey: null,
    status: "refreshed",
    error: null,
    attemptedAt: NOW,
    checkedAt: NOW,
    updatedAt: NOW,
    ...patch,
  });

  test("daily, weekly and monthly kinds are due once their local period has passed", () => {
    const due = (schedule: "daily" | "weekly" | "monthly", later: number) => isDue(schedule, row({}), NOW + later, TZ);

    expect([due("daily", 0), due("daily", DAY), due("weekly", DAY), due("weekly", 2 * DAY), due("monthly", 7 * DAY), due("monthly", 17 * DAY)]).toEqual([false, true, false, true, false, true]);
  });

  test("a kind that is off or deleted is never due", () => {
    expect([isDue("daily", row({ enabled: false, checkedAt: null }), NOW, TZ), isDue("daily", row({ removedAt: NOW, checkedAt: null }), NOW, TZ)]).toEqual([false, false]);
  });

  test("the next refresh is the first day of the next period", () => {
    expect([nextRefreshDay("daily", NOW, NOW, TZ), nextRefreshDay("weekly", NOW, NOW, TZ), nextRefreshDay("monthly", NOW, NOW, TZ), nextRefreshDay("picks", NOW, NOW, TZ)]).toEqual(["2026-11-15", "2026-11-16", "2026-12-01", null]);
  });

  test("the scheduler tick refreshes only kinds that are due", async () => {
    const { db, deps, sent } = setup();
    seed(db, [track("a", "A", "X", null)], listens("a", 3, 1));
    db.insert(livingPlaylists).values({ kind: "most-played", enabled: true, playlistId: null, playlistUrl: null, updatedAt: 0 }).run();

    const result = await runLiving(deps);

    expect([result.due, sent()]).toEqual([1, ["POST /me/playlists", "PUT /playlists/pl1/items", "PUT /playlists/pl1/images"]]);
  });

  test("the living job is registered and can be disabled like the others", () => {
    const db = testDb();
    const config = testConfig({ JOBS_DISABLED: "living" });
    const settings = testSettings(db, config);
    const auth = new SpotifyAuth(db, config, settings);
    const spotify = new SpotifyClient(db, auth, settings);
    const jobs = createJobs(db, settings, auth, spotify, createServices(db, config, settings, spotify, { llmTransport: null }));

    expect([jobs.living.name, enabledJobs(jobs, config).some((j) => j.name === "living")]).toEqual(["living", false]);
  });

  test("the living job skips while Spotify is not connected", async () => {
    const db = testDb();
    const config = testConfig();
    const settings = testSettings(db, config);
    const auth = new SpotifyAuth(db, config, settings);
    const spotify = new SpotifyClient(db, auth, settings);
    const jobs = createJobs(db, settings, auth, spotify, createServices(db, config, settings, spotify, { llmTransport: null }));

    expect(await jobs.living.run()).toEqual({ skipped: "spotify_not_connected" });
  });
});

describe("list", () => {
  test("shows each playlist's first five songs: what a refresh would put in it while it is off", () => {
    const { db, deps } = setup();
    seed(db, ["a", "b", "c", "d", "e", "f"].map((id) => track(id, id, "A", null)), ["a", "b", "c", "d", "e", "f"].flatMap((id, i) => listens(id, 8 - i, 3)));

    const mostPlayed = livingList(deps).items.find((p) => p.kind === "most-played")!;

    expect([mostPlayed.available, names(mostPlayed.songs)]).toEqual([6, ["a", "b", "c", "d", "e"]]);
  });

  test("shows nothing for a playlist with nothing to put in it", () => {
    const { deps } = setup();

    expect(livingList(deps).items.map((p) => p.songs.length)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("HTTP", () => {
  test("lists every living playlist, all off at first", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const body = (await (await app.request("/api/living", { headers: { cookie } })).json()) as { items: { kind: string; enabled: boolean }[] };

    expect(body.items.map((i) => [i.kind, i.enabled])).toEqual(Object.keys(LIVING).map((k) => [k, false]));
  });

  test("switching on without Spotify answers 409", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    const res = await app.request("/api/living/picks", { method: "PATCH", headers: { cookie, "content-type": "application/json", origin: "http://localhost:8888" }, body: JSON.stringify({ enabled: true }) });

    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([409, "spotify_not_connected"]);
  });

  test("serves the fixed cover, cached for good at its versioned URL", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;
    const list = (await (await app.request("/api/living", { headers: { cookie } })).json()) as { items: { coverUrl: string }[] };

    const res = await app.request(list.items[0]!.coverUrl, { headers: { cookie } });

    expect([res.status, res.headers.get("content-type"), res.headers.get("cache-control")]).toEqual([200, "image/jpeg", "private, max-age=31536000, immutable"]);
  });

  test("an unknown kind is a 400", async () => {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;

    expect((await app.request("/api/living/nope", { headers: { cookie } })).status).toBe(400);
  });
});

