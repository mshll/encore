import { describe, expect, test } from "bun:test";
import { AppPlaylists, NotAppPlaylistError } from "../src/dj/playlists";
import { createDefaultReplanner, type Replanner } from "../src/dj/replan";
import { DjService } from "../src/dj/session";
import type { FinishedPlay, Observation } from "../src/ingest/live/observe";
import { NoActiveDeviceError, PlayerApi } from "../src/player/api";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import type { TagInput } from "../src/tags/schema";
import { upsertTags } from "../src/tags/service";
import { connectSpotify, jsonResponse, noContent, play, routeFetch, seed, testConfig, testDb, track, uri, type FetchCall, testSettings, WEEKEND } from "./helpers";

const PLAYLIST = "pl0000000000000000000a";
const CONTEXT = `spotify:playlist:${PLAYLIST}`;
const set = ["1", "2", "3", "4", "5", "6"].map(uri);

function setup(replanner: Replanner, respond: (call: FetchCall) => Response | undefined = () => undefined) {
  const db = testDb();
  const config = testConfig();
  const settings = testSettings(db, config);
  connectSpotify(db);
  const { fn, calls } = routeFetch((call) => {
    const custom = respond(call);
    if (custom) return custom;
    if (call.method === "POST" && call.url.endsWith("/me/playlists")) return jsonResponse({ id: PLAYLIST }, 201);
    if (call.url.includes(`/playlists/${PLAYLIST}/items`)) return jsonResponse({ snapshot_id: "s" });
    if (call.url.includes("/me/player")) return noContent();
    return undefined;
  });
  const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, settings, fn), settings, fn);
  const playlists = new AppPlaylists(db, spotify);
  const dj = new DjService(db, new PlayerApi(spotify), playlists, replanner, () => 2);
  return { db, dj, calls, playlists };
}

const started = (trackUri: string, contextUri: string | null = CONTEXT) => ({ type: "started" as const, observation: { trackUri, contextUri } as Observation });
const ended = (trackUri: string, reasonEnd: FinishedPlay["reasonEnd"], msPlayed: number) => ({
  type: "finished" as const,
  play: { trackUri, contextUri: CONTEXT, reasonEnd, msPlayed, durationMs: 200_000 } as FinishedPlay,
});
const finished = (trackUri: string, skipped: boolean) => (skipped ? ended(trackUri, "fwdbtn", 10_000) : ended(trackUri, "trackdone", 200_000));

describe("dj session", () => {
  test("start fills an app-owned playlist and plays it in order with shuffle off", async () => {
    const { dj, calls } = setup(async () => []);
    const session = await dj.start([...set, set[0]!], "dev1");
    expect(session).toMatchObject({ status: "active", uris: set, position: 0, playlistId: PLAYLIST });
    expect(calls.map((c) => [c.method, c.url.replace("https://api.spotify.com/v1", ""), c.body])).toEqual([
      ["POST", "/me/playlists", { name: "encore session", description: expect.any(String), public: false }],
      ["PUT", `/playlists/${PLAYLIST}/items`, { uris: set }],
      ["PUT", "/me/player/play?device_id=dev1", { context_uri: CONTEXT, offset: { position: 0 } }],
      ["PUT", "/me/player/shuffle?state=false&device_id=dev1", undefined],
    ]);
  });

  test("two skips in a row re-plan and rewrite only the unplayed tail", async () => {
    let input: Parameters<Replanner>[0] | undefined;
    const { dj, calls } = setup(async (i) => {
      input = i;
      return [set[5]!, set[0]!, uri("9"), set[4]!];
    });
    await dj.start(set);
    calls.length = 0;
    dj.onWatchEvent(started(set[0]!));
    dj.onWatchEvent(finished(set[0]!, true));
    dj.onWatchEvent(started(set[1]!));
    expect(calls).toHaveLength(0);
    dj.onWatchEvent(finished(set[1]!, true));
    dj.onWatchEvent(started(set[2]!));
    await dj.whenIdle();
    expect(input).toMatchObject({ skipped: [set[0], set[1]], finished: [], current: set[2], upcoming: set.slice(3), exclude: set.slice(0, 3) });
    expect(calls.map((c) => [c.method, c.body])).toEqual([
      ["DELETE", { items: set.slice(3).map((u) => ({ uri: u })) }],
      ["POST", { uris: [set[5], uri("9"), set[4]] }],
    ]);
    expect(dj.active()).toMatchObject({ uris: [...set.slice(0, 3), set[5], uri("9"), set[4]], position: 2, replans: 1, skipStreak: 0, replanSkips: 2, replannedAt: expect.any(Number) });
  });

  test("a re-plan keeps the track that became current while it was computing", async () => {
    let dj!: DjService;
    const env = setup(async () => {
      dj.onWatchEvent(started(set[3]!));
      return [set[3]!, set[5]!, uri("9")];
    });
    dj = env.dj;
    await dj.start(set);
    env.calls.length = 0;
    dj.onWatchEvent(started(set[0]!));
    dj.onWatchEvent(finished(set[0]!, true));
    dj.onWatchEvent(started(set[1]!));
    dj.onWatchEvent(finished(set[1]!, true));
    dj.onWatchEvent(started(set[2]!));
    await dj.whenIdle();
    expect(env.calls.map((c) => [c.method, c.body])).toEqual([
      ["DELETE", { items: set.slice(4).map((u) => ({ uri: u })) }],
      ["POST", { uris: [set[5], uri("9")] }],
    ]);
    expect(dj.active()).toMatchObject({ uris: [...set.slice(0, 4), set[5], uri("9")], position: 3 });
  });

  test("a finished song resets the streak", async () => {
    const { dj, calls } = setup(async () => []);
    await dj.start(set);
    calls.length = 0;
    for (const [i, skipped] of [true, false, true].entries()) {
      dj.onWatchEvent(finished(set[i]!, skipped));
      dj.onWatchEvent(started(set[i + 1]!));
    }
    await dj.whenIdle();
    expect(calls).toHaveLength(0);
    expect(dj.active()?.skipStreak).toBe(1);
  });

  test("next pressed in the outro is played through and resets the streak", async () => {
    const { dj } = setup(async () => []);
    await dj.start(set);

    dj.onWatchEvent(finished(set[0]!, true));
    dj.onWatchEvent(ended(set[1]!, "fwdbtn", 185_000));

    expect(dj.active()).toMatchObject({ skipStreak: 0, outcomes: [{ outcome: "skipped" }, { outcome: "finished" }] });
  });

  test("going back is no skip and leaves the streak alone", async () => {
    const { dj } = setup(async () => []);
    await dj.start(set);

    dj.onWatchEvent(finished(set[0]!, true));
    dj.onWatchEvent(ended(set[1]!, "endplay", 5_000));

    expect(dj.active()).toMatchObject({ skipStreak: 1, outcomes: [{ outcome: "skipped" }] });
  });

  test("leaving the playlist ends the session", async () => {
    const { dj } = setup(async () => []);
    await dj.start(set);
    dj.onWatchEvent(started(uri("x"), "spotify:album:other"));
    expect(dj.active()).toBeUndefined();
    expect(dj.latest()).toMatchObject({ status: "ended", endReason: "left_playlist" });
  });

  test("no active device is a typed error and leaves no session", async () => {
    const { dj } = setup(async () => [], (call) =>
      call.url.includes("/me/player/play") ? jsonResponse({ error: { status: 404, message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" } }, 404) : undefined,
    );
    await expect(dj.start(set)).rejects.toBeInstanceOf(NoActiveDeviceError);
    expect(dj.active()).toBeUndefined();
  });

  test("playlist writes refuse playlists encore does not own", async () => {
    const { playlists } = setup(async () => []);
    await expect(playlists.remove("someone_elses", [set[0]!])).rejects.toBeInstanceOf(NotAppPlaylistError);
  });
});

describe("default re-planner", () => {
  test("keeps a song skipped everywhere but ranks it by context fit, and moves toward the tags of played-through songs", async () => {
    const db = testDb();
    const tracks = ["f", "s", "x", "y", "d"].map((id) => track(id, `Song ${id}`, `Artist ${id}`, "Album"));
    const dislikePlays = Array.from({ length: 10 }, (_, i) => play(`2026-01-0${(i % 9) + 1}T10:00:00Z`, uri("d"), 5000, { skipped: true, reasonEnd: "fwdbtn" }));
    seed(db, tracks, dislikePlays);
    const tag = (id: string, genres: TagInput["genres"], energy: number): TagInput => ({ uri: uri(id), genres, moods: ["calm"], energy, valence: 3, language: "en", model: "t", confidence: "high" });
    upsertTags(db, [tag("f", ["jazz"], 2), tag("s", ["metal"], 5), tag("x", ["metal"], 5), tag("y", ["jazz"], 2), tag("d", ["jazz"], 2)]);
    const replan = createDefaultReplanner(db, () => ({ timezone: "Asia/Kuwait", weekendDays: WEEKEND }));
    const next = await replan({ finished: [uri("f")], skipped: [uri("s")], current: uri("f"), upcoming: [uri("x"), uri("d"), uri("y")], exclude: [uri("f"), uri("s")], now: Date.parse("2026-11-14T10:00:00Z") });
    expect(next).toEqual([uri("y"), uri("d"), uri("x")]);
  });
});
