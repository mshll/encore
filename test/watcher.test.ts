import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { playOutcome } from "../src/analytics/common";
import { step, type Observation, type Snapshot } from "../src/ingest/live/observe";
import { Watcher } from "../src/ingest/live/watcher";
import { getJobState } from "../src/jobs/state";
import { runJob } from "../src/jobs/scheduler";
import { PlayerApi } from "../src/player/api";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import type { PlaybackState } from "../src/spotify/types";
import { connectSpotify, jsonResponse, noContent, routeFetch, testConfig, testDb, uri, testSettings } from "./helpers";

const STALE = 150_000;
const A = uri("a");
const B = uri("b");

const snap = (trackUri: string, progressMs: number, extra: Partial<Snapshot> = {}): Snapshot => ({
  trackUri,
  durationMs: 200_000,
  progressMs,
  isPlaying: true,
  shuffle: false,
  deviceName: "iPhone",
  deviceType: "Smartphone",
  contextUri: "spotify:playlist:p",
  ...extra,
});

function run(sequence: [number, Snapshot | null][]) {
  let current: Observation | null = null;
  const finished = [];
  for (const [at, s] of sequence) {
    const r = step(current, s, at, STALE);
    current = r.current;
    finished.push(...r.finished);
  }
  return { current, finished };
}

describe("watcher state machine", () => {
  test("a track played to the end is a finished, not skipped, play", () => {
    const { finished, current } = run([
      [0, snap(A, 0)],
      [15_000, snap(A, 15_000)],
      [195_000, snap(A, 195_000)],
      [210_000, snap(B, 10_000)],
    ]);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ trackUri: A, skipped: false, reasonEnd: "trackdone", msPlayed: 200_000, endedAt: 200_000, startedAt: 0 });
    expect(current).toMatchObject({ trackUri: B, reasonStart: "trackdone", startedAt: 200_000 });
  });

  test("a track changed before 90% is a skip, and the next track starts as fwdbtn", () => {
    const { finished, current } = run([
      [0, snap(A, 0)],
      [15_000, snap(A, 15_000)],
      [30_000, snap(B, 5_000)],
    ]);
    expect(finished[0]).toMatchObject({ trackUri: A, skipped: true, reasonEnd: "fwdbtn", msPlayed: 25_000, endedAt: 25_000 });
    expect(current?.reasonStart).toBe("fwdbtn");
  });

  test("changing in the outro is flagged like Spotify's next but counts as played through", () => {
    const { finished } = run([
      [0, snap(A, 170_000)],
      [15_000, snap(A, 185_000)],
      [16_000, snap(B, 0)],
    ]);

    expect(playOutcome(finished[0]!)).toBe("through");
  });

  test("pause and resume count only progress that was played", () => {
    const { finished } = run([
      [0, snap(A, 0)],
      [15_000, snap(A, 15_000)],
      [75_000, snap(A, 20_000, { isPlaying: false })],
      [135_000, snap(A, 20_000, { isPlaying: false })],
      [150_000, snap(A, 35_000)],
      [165_000, snap(B, 0)],
    ]);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ trackUri: A, msPlayed: 50_000, skipped: true });
  });

  test("a repeated track becomes two plays", () => {
    const { finished, current } = run([
      [0, snap(A, 0)],
      [190_000, snap(A, 190_000)],
      [205_000, snap(A, 5_000)],
    ]);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ trackUri: A, skipped: false, reasonEnd: "trackdone", msPlayed: 200_000 });
    expect(current).toMatchObject({ trackUri: A, reasonStart: "trackdone", startedAt: 200_000 });
  });

  test("seeking back inside a track is not a repeat", () => {
    const { finished, current } = run([
      [0, snap(A, 0)],
      [60_000, snap(A, 60_000)],
      [75_000, snap(A, 10_000)],
    ]);
    expect(finished).toHaveLength(0);
    expect(current?.playedMs).toBe(60_000);
  });

  test("moving playback to another device keeps one play and records the new device", () => {
    const { finished, current } = run([
      [0, snap(A, 0)],
      [15_000, snap(A, 15_000)],
      [30_000, snap(A, 30_000, { deviceName: "Kitchen", deviceType: "Speaker" })],
    ]);
    expect(finished).toHaveLength(0);
    expect(current).toMatchObject({ trackUri: A, deviceType: "Speaker", playedMs: 30_000 });
  });

  test("playback stopping ends the play without calling it a skip", () => {
    const { finished, current } = run([
      [0, snap(A, 0)],
      [15_000, snap(A, 15_000, { isPlaying: false })],
      [75_000, null],
    ]);
    expect(current).toBeNull();
    expect(finished[0]).toMatchObject({ skipped: false, reasonEnd: "endplay", msPlayed: 15_000 });
  });

  test("a gap longer than the stale limit leaves the end unknown", () => {
    const { finished } = run([
      [0, snap(A, 0)],
      [15_000, snap(A, 15_000)],
      [15_000 + STALE + 1, snap(B, 30_000)],
    ]);
    expect(finished[0]).toMatchObject({ trackUri: A, skipped: null, reasonEnd: null, msPlayed: 15_000 });
  });
});

const state = (trackUri: string | null, progressMs: number, isPlaying = true): PlaybackState => ({
  device: { id: "d1", is_active: true, is_restricted: false, name: "iPhone", type: "Smartphone", volume_percent: 50 },
  shuffle_state: true,
  repeat_state: "off",
  timestamp: 0,
  progress_ms: progressMs,
  is_playing: isPlaying,
  currently_playing_type: "track",
  item: trackUri
    ? { id: trackUri.split(":")[2]!, uri: trackUri, name: `Song ${trackUri.slice(-1)}`, duration_ms: 200_000, artists: [{ id: "ar1", name: "Artist", uri: "spotify:artist:ar1" }], album: { id: "al", name: "Album", images: [{ url: "https://img/a", width: 640, height: 640 }] } }
    : null,
  context: { uri: "spotify:playlist:p", type: "playlist" },
});

function setup(responses: (Response | (() => Response))[]) {
  const db = testDb();
  const config = testConfig();
  const settings = testSettings(db, config);
  connectSpotify(db);
  let clock = 1_000_000_000_000;
  const now = () => clock;
  const queue = [...responses];
  const { fn, calls } = routeFetch(() => {
    const next = queue.shift();
    return typeof next === "function" ? next() : next;
  });
  const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, settings, fn, now), settings, fn, now);
  const make = () => new Watcher(db, new PlayerApi(spotify), settings, now);
  return { db, config: settings.get(), calls, make, advance: (ms: number) => (clock += ms), now };
}

describe("watcher service", () => {
  test("idles at the idle cadence when nothing plays and polls faster while playing", async () => {
    const { make, calls, config } = setup([noContent(), jsonResponse(state(A, 1000))]);
    const watcher = make();
    expect(await watcher.tick()).toMatchObject({ playing: false, inserted: 0 });
    expect(watcher.nextDelayMs()).toBe(config.watcherIdleMs);
    await watcher.tick();
    expect(watcher.nextDelayMs()).toBe(config.watcherActiveMs);
    expect(calls.map((c) => c.url)).toEqual(["https://api.spotify.com/v1/me/player", "https://api.spotify.com/v1/me/player"]);
  });

  test("backs off on 429 and does not call Spotify while the gate is closed", async () => {
    const { make, calls, advance, config } = setup([jsonResponse({}, 429, { "retry-after": "120" })]);
    const watcher = make();
    expect(await watcher.tick()).toMatchObject({ skipped: "spotify_paused" });
    expect(watcher.nextDelayMs()).toBe(120_000);
    advance(60_000);
    expect(await watcher.tick()).toMatchObject({ skipped: "spotify_paused" });
    expect(calls).toHaveLength(1);
    expect(watcher.nextDelayMs()).toBeGreaterThanOrEqual(Math.min(config.watcherBackoffMaxMs, config.watcherActiveMs * 4));
  });

  test("stores a live play with device, shuffle and context, and survives a restart mid-track", async () => {
    const { db, make, advance } = setup([jsonResponse(state(A, 0)), jsonResponse(state(A, 30_000)), jsonResponse(state(B, 5_000))]);
    const first = make();
    await runJob(db, { name: "watch", intervalMs: () => 1, run: () => first.tick() });
    advance(30_000);
    const restarted = make();
    expect(restarted.observation()?.trackUri).toBe(A);
    await runJob(db, { name: "watch", intervalMs: () => 1, run: () => restarted.tick() });
    advance(15_000);
    await runJob(db, { name: "watch", intervalMs: () => 1, run: () => restarted.tick() });
    const rows = db.all(sql`select track_uri, ms_played, skipped, shuffle, device, source, context_uri, reason_end from plays`);
    expect(rows).toEqual([{ track_uri: A, ms_played: 40_000, skipped: 1, shuffle: 1, device: "ios", source: "live", context_uri: "spotify:playlist:p", reason_end: "fwdbtn" }]);
    expect((getJobState(db, "watch")?.data as { current: Observation }).current.trackUri).toBe(B);
  });

  test("now playing is served from the cache without another Spotify call", async () => {
    const { make, calls, advance } = setup([jsonResponse(state(A, 10_000))]);
    const watcher = make();
    await watcher.tick();
    advance(5_000);
    const now = await watcher.nowPlaying(60_000);
    expect(now).toMatchObject({ playing: true, progressMs: 15_000, track: { uri: A, name: "Song a", albumArtUrl: "https://img/a" }, device: { name: "iPhone" } });
    expect(calls).toHaveLength(1);
  });
});
