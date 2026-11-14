import { describe, expect, test } from "bun:test";
import { linkArtists } from "../src/plays/store";
import { listReleases, markReleasesSeen, newReleasesSince, radarCandidates, runRadar } from "../src/radar/radar";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { connectSpotify, jsonResponse, play, routeFetch, seed, testConfig, testDb, track, uri } from "./helpers";

const NOW = Date.parse("2026-11-14T09:00:00Z");
const DAY = 86_400_000;

const album = (id: string, date: string, type = "single") => ({
  id,
  uri: `spotify:album:${id}`,
  name: `Release ${id}`,
  album_type: type,
  release_date: date,
  release_date_precision: "day",
  total_tracks: 1,
  images: [{ url: `https://img/${id}`, width: 640, height: 640 }],
  artists: [{ id: "artistA", name: "Artist A" }],
});

function setup(albums: Record<string, unknown[]>, env: Record<string, string> = {}) {
  const db = testDb();
  const config = testConfig({ RADAR_MIN_LISTENS: "3", RADAR_ARTISTS_PER_RUN: "2", ...env });
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
  const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, fn), config, fn);
  return { db, config, spotify, calls };
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
    expect(markReleasesSeen(db, undefined, later)).toBe(2);
    expect(listReleases(db, { status: "new", since: "0000", limit: 10 })).toEqual([]);
  });

  test("asks for singles separately when the first page is cut off, since Spotify lists all albums before any single", async () => {
    const many = Array.from({ length: 9 }, (_, i) => album(`al${i}`, `2019-01-${String(i + 1).padStart(2, "0")}`, "album"));
    const { db, config, spotify, calls } = setup({ artistA: [...many, album("s0", "2026-11-01"), album("s1", "2026-11-10")] }, { RADAR_ARTISTS_PER_RUN: "1" });
    expect(await runRadar(db, spotify, config, NOW)).toMatchObject({ checked: 1, calls: 2, newReleases: 2 });
    expect(calls.map((c) => new URL(c.url).searchParams.get("include_groups"))).toEqual(["album,single", "single"]);
  });
});
