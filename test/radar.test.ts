import { describe, expect, test } from "bun:test";
import { linkArtists } from "../src/plays/store";
import { listReleases, markReleasesSeen, newReleasesSince, radarCandidates, runRadar } from "../src/radar/radar";
import { isReissue } from "../src/radar/reissue";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { connectSpotify, jsonResponse, play, routeFetch, seed, testConfig, testDb, track, uri, testSettings } from "./helpers";

const NOW = Date.parse("2026-11-14T09:00:00Z");
const DAY = 86_400_000;

const ARTIST_A = { id: "artistA", name: "Artist A" };

const album = (id: string, date: string, type = "single", extra: { name?: string; artists?: { id: string; name: string }[]; album_group?: string } = {}) => ({
  id,
  uri: `spotify:album:${id}`,
  name: extra.name ?? `Release ${id}`,
  album_type: type,
  album_group: extra.album_group ?? type,
  release_date: date,
  release_date_precision: "day",
  total_tracks: 1,
  images: [{ url: `https://img/${id}`, width: 640, height: 640 }],
  artists: extra.artists ?? [ARTIST_A],
});

function setup(albums: Record<string, unknown[]>, env: Record<string, string> = {}) {
  const db = testDb();
  const config = testConfig({ RADAR_MIN_LISTENS: "3", RADAR_ARTISTS_PER_RUN: "2", ...env });
  const settings = testSettings(db, config);
  connectSpotify(db);
  const listens = (id: string, n: number) => Array.from({ length: n }, (_, i) => play(new Date(NOW - (i + 1) * DAY).toISOString(), uri(id), 200_000));
  seed(db, [track("a1", "A one", "Artist A", "X"), track("b1", "B one", "Artist B", "Y"), track("c1", "C one", "Artist C", "Z")], [...listens("a1", 5), ...listens("b1", 4), ...listens("c1", 1)]);
  linkArtists(db, uri("a1"), [{ id: "artistA", name: "Artist A" }]);
  const { fn, calls } = routeFetch((call) => {
    const artist = call.url.match(/artists\/(\w+)\/albums/)?.[1];
    if (artist) {
      const groups = new URL(call.url).searchParams.get("include_groups")!;
      const items = (albums[artist] ?? []).filter((a) => groups.split(",").includes((a as { album_type: string }).album_type));
      return jsonResponse({ items: items.slice(0, 10), total: items.length, next: null, offset: 0, limit: 10 });
    }
    if (call.url.includes(`/tracks/${uri("b1").split(":")[2]}`)) {
      return jsonResponse({ id: "b1", uri: uri("b1"), name: "B one", duration_ms: 1, artists: [{ id: "artistB", name: "Artist B", uri: "spotify:artist:artistB" }], album: { id: "y", name: "Y" } });
    }
    return undefined;
  });
  const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, settings, fn), settings, fn);
  return { db, config: settings.get(), spotify, calls };
}

describe("release radar", () => {
  test("candidates are artists with enough listens in the last year", () => {
    const { db } = setup({});
    expect(radarCandidates(db, 3, NOW).map((c) => [c.artist, c.listens, c.artistId])).toEqual([
      ["Artist A", 5, "artistA"],
      ["Artist B", 4, null],
    ]);
  });

  test("first check flags recent releases as new; later checks flag only releases since the last check", async () => {
    const releases = { artistA: [album("old", "2026-01-01"), album("recent", "2026-11-01")] as unknown[] };
    const { db, config, spotify, calls } = setup(releases);
    const first = await runRadar(db, spotify, config, NOW);
    expect(first).toMatchObject({ due: 2, checked: 1, resolved: 1, found: 2, newReleases: 1, calls: 2 });
    expect(listReleases(db, { status: "new", since: "0000", limit: 10 }).map((r) => r.id)).toEqual(["recent"]);

    expect(await runRadar(db, spotify, config, NOW + DAY)).toMatchObject({ checked: 1, calls: 1 });
    const callsBefore = calls.length;
    expect(await runRadar(db, spotify, config, NOW + 2 * DAY)).toMatchObject({ due: 0, calls: 0 });
    expect(calls.length).toBe(callsBefore);

    releases.artistA.push(album("fresh", "2026-11-20"), album("backfill", "2020-05-05"));
    const later = NOW + 8 * DAY;
    expect(await runRadar(db, spotify, config, later)).toMatchObject({ found: 2, newReleases: 1 });
    expect(newReleasesSince(db, later).map((r) => r.id)).toEqual(["fresh"]);
    expect(markReleasesSeen(db, "new", later)).toBe(2);
    expect(listReleases(db, { status: "new", since: "0000", limit: 10 })).toEqual([]);
  });

  test("asks for singles separately when the first page is cut off, since Spotify lists all albums before any single", async () => {
    const many = Array.from({ length: 9 }, (_, i) => album(`al${i}`, `2019-01-${String(i + 1).padStart(2, "0")}`, "album"));
    const { db, config, spotify, calls } = setup({ artistA: [...many, album("s0", "2026-11-01"), album("s1", "2026-11-10")] }, { RADAR_ARTISTS_PER_RUN: "1" });
    expect(await runRadar(db, spotify, config, NOW)).toMatchObject({ checked: 1, calls: 2, newReleases: 2 });
    expect(calls.map((c) => new URL(c.url).searchParams.get("include_groups"))).toEqual(["album,single", "single"]);
  });

  test("a release is stored under the album's lead artist, and albums that do not credit the checked artist are dropped", async () => {
    const dj = { id: "djceo", name: "DJ CEO" };
    const big = { id: "bigx", name: "BigXthaPlug" };
    const { db, config, spotify } = setup(
      {
        artistA: [
          album("holy", "2026-11-01", "single", { name: "Holy Ghost", artists: [dj, ARTIST_A] }),
          album("lite", "2026-11-02", "single", { name: "LITE (remix)", artists: [big, ARTIST_A] }),
          album("own", "2026-11-03"),
          album("guest", "2026-11-04", "single", { name: "Guest spot", artists: [dj], album_group: "appears_on" }),
          album("uncredited", "2026-11-05", "single", { name: "Not theirs", artists: [big] }),
        ],
      },
      { RADAR_ARTISTS_PER_RUN: "1" },
    );
    await runRadar(db, spotify, config, NOW);
    expect(listReleases(db, { status: "new", since: "0000", limit: 10 }).map((r) => [r.id, r.artist, r.artistId])).toEqual([
      ["own", "Artist A", "artistA"],
      ["lite", "BigXthaPlug", "bigx"],
      ["holy", "DJ CEO", "djceo"],
    ]);
  });

  test("lists hide seen releases and re-releases unless asked for them", async () => {
    const { db, config, spotify } = setup(
      { artistA: [album("fresh", "2026-11-01"), album("remaster", "2026-11-02", "single", { name: "Old Hit (Remastered 2026)" }), album("seen", "2026-11-03")] },
      { RADAR_ARTISTS_PER_RUN: "1" },
    );
    await runRadar(db, spotify, config, NOW);
    expect(markReleasesSeen(db, ["seen"], NOW)).toBe(1);
    const ids = (filter: { includeSeen?: boolean; includeReissues?: boolean }, status: "new" | "recent" = "new") => listReleases(db, { status, since: "2026-01-01", limit: 10, ...filter }).map((r) => r.id);
    expect(ids({})).toEqual(["fresh"]);
    expect(ids({}, "recent")).toEqual(["fresh"]);
    expect(ids({ includeSeen: true })).toEqual(["seen", "fresh"]);
    expect(ids({ includeReissues: true })).toEqual(["remaster", "fresh"]);
    expect(newReleasesSince(db, 0).map((r) => r.id)).toEqual(["seen", "fresh"]);
  });

  test("marking all as seen covers releases not flagged new; marking new does not", async () => {
    const { db, config, spotify } = setup({ artistA: [album("fresh", "2026-11-01"), album("old", "2025-01-01")] }, { RADAR_ARTISTS_PER_RUN: "1" });
    await runRadar(db, spotify, config, NOW);
    expect(markReleasesSeen(db, "new", NOW)).toBe(1);
    expect(listReleases(db, { status: "recent", since: "2000-01-01", limit: 10 }).map((r) => r.id)).toEqual(["old"]);
    expect(markReleasesSeen(db, "all", NOW)).toBe(1);
    expect(listReleases(db, { status: "recent", since: "2000-01-01", limit: 10 })).toEqual([]);
  });
});

describe("re-releases", () => {
  test.each([
    ["Riders On The Storm (Remastered 2026)", "single"],
    ["Don't Stop Dancing (Acoustic Version / Remastered 2026)", "single"],
    ["ReLoad (Remastered Deluxe Box Set)", "album"],
    ["Handball (Live at The Palmer Auditorium, New London, CT - December 5, 1976)", "single"],
    ["Live at Wembley Stadium", "album"],
    ["Alive (Live)", "single"],
    ["The Divine Feminine (10th Anniversary)", "album"],
    ["BULLY - DELUXE", "album"],
    ["Fearless [Deluxe Edition]", "album"],
    ["1989 (Re-Recorded)", "album"],
    ["Greatest Hits", "compilation"],
  ])("%s is a re-release", (name, albumType) => expect(isReissue({ name, albumType })).toBe(true));

  test.each([
    ["Wild Love", "album"],
    ["Live Forever", "single"],
    ["Live Your Life", "single"],
    ["Anniversary", "album"],
    ["Deluxe", "single"],
    ["Loser (Fcukers Remix)", "single"],
    ["Iron Man - A COLORS SHOW", "single"],
    ["Flower In A Hurricane (feat. Tame Impala, SZA) [From GTAVI: Original Score]", "single"],
    ["Remember Me", "single"],
    ["Delivery", "single"],
  ])("%s is new music", (name, albumType) => expect(isReissue({ name, albumType })).toBe(false));
});
