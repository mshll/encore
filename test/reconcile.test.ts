import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { importExport } from "../src/ingest/export/import";
import type { FinishedPlay } from "../src/ingest/live/observe";
import { pollRecentlyPlayed } from "../src/ingest/live/poller";
import { recordLivePlays } from "../src/ingest/live/reconcile";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { connectSpotify, jsonResponse, routeFetch, testConfig, testDb, track, TZ, uri, testSettings } from "./helpers";
import { upsertTracks } from "../src/plays/store";

const A = uri("a");
const B = uri("b");
const T0 = Date.parse("2026-11-14T10:00:00.000Z");

const live = (trackUri: string, startedAt: number, msPlayed: number, extra: Partial<FinishedPlay> = {}): FinishedPlay => ({
  trackUri,
  durationMs: 200_000,
  shuffle: true,
  deviceName: "iPhone",
  deviceType: "Smartphone",
  contextUri: null,
  startedAt,
  reasonStart: null,
  endedAt: startedAt + msPlayed,
  msPlayed,
  skipped: msPlayed < 180_000,
  reasonEnd: msPlayed < 180_000 ? "fwdbtn" : "trackdone",
  ...extra,
});

const spotifyTrack = (trackUri: string) => ({
  id: trackUri.split(":")[2]!,
  uri: trackUri,
  name: `Song ${trackUri.slice(-1)}`,
  duration_ms: 200_000,
  artists: [{ id: "ar", name: "Artist", uri: "spotify:artist:ar" }],
  album: { id: "al", name: "Album" },
});

function setup() {
  const db = testDb();
  const config = testConfig();
  const settings = testSettings(db, config);
  connectSpotify(db);
  upsertTracks(db, [track("a", "Song a", "Artist", "Album"), track("b", "Song b", "Artist", "Album")]);
  let recent: { track: ReturnType<typeof spotifyTrack>; played_at: string }[] = [];
  const { fn } = routeFetch(() => jsonResponse({ items: recent }));
  const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, settings, fn), settings, fn);
  const poll = (items: [string, number][]) => {
    recent = items.map(([u, ts]) => ({ track: spotifyTrack(u), played_at: new Date(ts).toISOString(), context: null }));
    return pollRecentlyPlayed(db, spotify, settings.get());
  };
  const rows = () => db.all<{ track_uri: string; source: string; ts: number; ms_played: number | null }>(sql`select track_uri, source, ts, ms_played from plays order by ts, id`);
  return { db, poll, rows };
}

describe("watcher and recently-played reconciliation", () => {
  test("watcher first: the poller skips the same play", async () => {
    const { db, poll, rows } = setup();
    recordLivePlays(db, [live(A, T0, 200_000)], { timezone: TZ });
    expect(await poll([[A, T0 + 201_500]])).toMatchObject({ inserted: 0, skippedCoveredByLive: 1 });
    expect(rows()).toEqual([{ track_uri: A, source: "live", ts: T0 + 200_000, ms_played: 200_000 }]);
  });

  test("poller first: the live row replaces the api row", async () => {
    const { db, poll, rows } = setup();
    await poll([[A, T0 + 199_000]]);
    expect(recordLivePlays(db, [live(A, T0, 200_000)], { timezone: TZ })).toEqual({ inserted: 1, replacedApi: 1, coveredByExport: 0 });
    expect(rows().map((r) => r.source)).toEqual(["live"]);
  });

  test("a track repeated back to back stays two plays from both sources", async () => {
    const { db, poll, rows } = setup();
    await poll([[A, T0 + 200_000]]);
    recordLivePlays(db, [live(A, T0, 200_000), live(A, T0 + 200_000, 200_000)], { timezone: TZ });
    await poll([
      [A, T0 + 400_000],
      [A, T0 + 200_000],
    ]);
    expect(rows()).toEqual([
      { track_uri: A, source: "live", ts: T0 + 200_000, ms_played: 200_000 },
      { track_uri: A, source: "live", ts: T0 + 400_000, ms_played: 200_000 },
    ]);
  });

  test("short skips the api never reports and api plays the watcher missed are both kept", async () => {
    const { db, poll, rows } = setup();
    recordLivePlays(db, [live(B, T0, 8_000)], { timezone: TZ });
    await poll([[A, T0 + 600_000]]);
    expect(rows().map((r) => [r.track_uri, r.source])).toEqual([
      [B, "live"],
      [A, "api"],
    ]);
  });

  test("the same live play recorded twice is stored once", () => {
    const { db, rows } = setup();
    recordLivePlays(db, [live(A, T0, 200_000)], { timezone: TZ });
    expect(recordLivePlays(db, [live(A, T0, 200_000)], { timezone: TZ }).inserted).toBe(0);
    expect(rows()).toHaveLength(1);
  });

  test("an export import supersedes live and api rows in its range, and later live plays inside it are ignored", async () => {
    const { db, poll, rows } = setup();
    recordLivePlays(db, [live(A, T0, 200_000)], { timezone: TZ });
    await poll([[B, T0 + 500_000]]);
    const exportRow = (ts: number, id: string) => ({
      ts: new Date(ts).toISOString().replace(/\.\d{3}Z$/, "Z"),
      platform: "ios",
      ms_played: 200000,
      conn_country: "KW",
      master_metadata_track_name: `Song ${id}`,
      master_metadata_album_artist_name: "Artist",
      master_metadata_album_album_name: "Album",
      spotify_track_uri: uri(id),
      reason_start: "trackdone",
      reason_end: "trackdone",
      shuffle: false,
      skipped: false,
      offline: false,
      incognito_mode: false,
    });
    const result = importExport(db, [{ name: "Streaming_History_Audio_2026.json", content: JSON.stringify([exportRow(T0 - 1000, "a"), exportRow(T0 + 600_000, "b")]) }], { timezone: TZ });
    expect(result.apiPlaysRemoved).toBe(2);
    expect(rows().every((r) => r.source === "export")).toBe(true);
    expect(recordLivePlays(db, [live(A, T0 + 100_000, 200_000)], { timezone: TZ })).toMatchObject({ inserted: 0, coveredByExport: 1 });
    expect(recordLivePlays(db, [live(A, T0 + 700_000, 200_000)], { timezone: TZ })).toMatchObject({ inserted: 1 });
  });

  test("live plays before the history start are not stored", () => {
    const { db, rows } = setup();

    const result = recordLivePlays(db, [live(A, T0, 200_000)], { timezone: TZ, historyStart: "2026-11-15" });

    expect(result.inserted).toBe(0);
    expect(rows()).toEqual([]);
  });
});
