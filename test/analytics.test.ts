import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { hours as h } from "../src/analytics/common";
import { albumPage, artistPage, trackPage } from "../src/analytics/entities";
import { history } from "../src/analytics/history";
import { clock, devices, overview, timeSeries } from "../src/analytics/overview";
import { forgotten, onThisDay } from "../src/analytics/recall";
import { search } from "../src/analytics/search";
import { classify, momentSplit, skipContext, skips } from "../src/analytics/skips";
import { energyByHour, genreSeries, moodSeries } from "../src/analytics/tags";
import { eras, topAlbums, topArtists, topTracks } from "../src/analytics/top";
import { trips } from "../src/analytics/trips";
import { artists, tracks } from "../src/db/schema";
import { songKey } from "../src/plays/song";
import { linkArtists } from "../src/plays/store";
import { upsertTags } from "../src/tags/service";
import { play, seed, testDb, track, uri, WEEKEND } from "./helpers";

const A1 = uri("a1");
const A2 = uri("a2");
const C = uri("c");
const KEY_A = songKey("Song A", "Artist X");

function baseFixture() {
  const db = testDb();
  seed(
    db,
    [
      track("a1", "Song A", "Artist X", "Album 1"),
      track("a2", "Song A - Remastered 2020", "Artist X", "Album 1 Deluxe"),
      track("c", "Song C", "Artist Y", "Album 2", { durationMs: 180000 }),
    ],
    [
      play("2026-01-05T10:00:00Z", A1, 200000, { reasonStart: "clickrow" }),
      play("2026-01-06T10:00:00Z", A1, 10000, { skipped: true, reasonEnd: "fwdbtn", device: "mac" }),
      play("2026-02-01T10:00:00Z", A2, 200000),
      play("2026-01-05T12:00:00Z", C, 3000, { skipped: true, shuffle: true, reasonEnd: "fwdbtn" }),
      play("2026-03-01T10:00:00Z", C, null),
      play("2026-01-05T15:00:00Z", null as unknown as string, 600000, { kind: "episode", episodeUri: "spotify:episode:x", episodeName: "Ep" }),
      play("2026-01-05T16:00:00Z", A1, 100000, { kind: "video" }),
    ],
  );
  return db;
}

describe("overview", () => {
  test("totals music plays only, using duration for api plays", () => {
    expect(overview(baseFixture(), { range: {} })).toEqual({
      hours: h(593_000),
      plays: 5,
      listens: 3,
      uniqueTracks: 2,
      uniqueArtists: 2,
      skipRate: 0.5,
      shuffleRate: 0.25,
      firstPlayed: "2026-01-05T10:00:00.000Z",
      lastPlayed: "2026-03-01T10:00:00.000Z",
      topArtist: { artist: "Artist X", imageUrl: null, hours: h(410_000), listens: 2 },
      topTrack: { songKey: KEY_A, uri: A1, name: "Song A", artist: "Artist X", albumArtUrl: null, hours: h(410_000), listens: 2 },
    });
  });

  test("a few seconds of listening count as those seconds, not rounded to zero", () => {
    const db = testDb();
    seed(db, [track("s", "Short", "Artist", null)], [play("2026-01-05T10:00:00Z", uri("s"), 20_000)]);

    const { hours } = overview(db, { range: {} });

    expect(hours).toBe(20_000 / 3_600_000);
  });

  test("respects the local date range and handles an empty range", () => {
    const db = baseFixture();
    expect(overview(db, { range: { from: "2026-02-01", to: "2026-02-28" } }).plays).toBe(1);
    const empty = overview(db, { range: { from: "2030-01-01" } });
    expect(empty).toMatchObject({ plays: 0, hours: 0, listens: 0, skipRate: null, topArtist: null, topTrack: null });
  });
});

describe("time series", () => {
  test("buckets by month and week", () => {
    const db = baseFixture();
    expect(timeSeries(db, { range: {}, period: "month" }).points).toEqual([
      { period: "2026-01", hours: h(213_000), plays: 3, listens: 1 },
      { period: "2026-02", hours: h(200_000), plays: 1, listens: 1 },
      { period: "2026-03", hours: 0.05, plays: 1, listens: 1 },
    ]);
    expect(timeSeries(db, { range: { to: "2026-01-31" }, period: "week" }).points.map((p) => [p.period, p.plays])).toEqual([["2026-01-05", 3]]);
  });
});

describe("top lists", () => {
  test("tracks merge the same song across URIs", () => {
    const [a, c] = topTracks(baseFixture(), { range: {}, limit: 10 });
    expect(a).toMatchObject({ songKey: KEY_A, uri: A1, plays: 3, listens: 2, skips: 1, skipRate: 0.333, firstPlayed: "2026-01-05T10:00:00.000Z", lastPlayed: "2026-02-01T10:00:00.000Z" });
    expect(c).toMatchObject({ uri: C, plays: 2, listens: 1, skipRate: 1, earlySkips: 1 });
  });

  test("tracks and artists narrow to a local weekday and hour", () => {
    const db = baseFixture();
    expect(topTracks(db, { range: {}, limit: 10, weekday: 1, hour: 13 }).map((t) => t.plays)).toEqual([1]);
    expect(topArtists(db, { range: {}, limit: 10, weekday: 1, hour: 15 }).map((a) => a.artist)).toEqual(["Artist Y"]);
    expect(topArtists(db, { range: {}, limit: 10, hour: 4 })).toEqual([]);
  });

  test("artists and albums, sortable", () => {
    const db = baseFixture();
    expect(topArtists(db, { range: {}, limit: 10 }).map((a) => [a.artist, a.plays, a.songs])).toEqual([
      ["Artist X", 3, 1],
      ["Artist Y", 2, 1],
    ]);
    expect(topAlbums(db, { range: {}, limit: 10, sort: "plays" }).map((a) => [a.album, a.plays])).toEqual([
      ["Album 1", 2],
      ["Album 2", 2],
      ["Album 1 Deluxe", 1],
    ]);
    expect(topArtists(db, { range: {}, limit: 1, offset: 1 })[0]!.artist).toBe("Artist Y");
  });

  test("a search narrows tracks by song or artist name and keeps merged stats", () => {
    const db = baseFixture();

    const tracks = topTracks(db, { range: {}, limit: 10, q: "artist x" });

    expect(tracks.map((t) => [t.songKey, t.plays])).toEqual([[KEY_A, 3]]);
  });

  test("a search narrows artists and albums", () => {
    const db = baseFixture();

    const artists = topArtists(db, { range: {}, limit: 10, q: "y" }).map((a) => a.artist);
    const albums = topAlbums(db, { range: {}, limit: 10, q: "deluxe" }).map((a) => a.album);

    expect([artists, albums]).toEqual([["Artist Y"], ["Album 1 Deluxe"]]);
  });

  test("a search treats % as text, not a wildcard", () => {
    const db = baseFixture();

    const albums = topAlbums(db, { range: {}, limit: 10, q: "%" });

    expect(albums).toEqual([]);
  });
});

describe("eras", () => {
  test("monthly hours per top artist aligned to a continuous month axis", () => {
    const result = eras(baseFixture(), { range: {}, limit: 2 });
    expect(result.months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(result.series).toEqual([
      { artist: "Artist X", hours: [h(210_000), h(200_000), 0] },
      { artist: "Artist Y", hours: [h(3_000), 0, 0.05] },
    ]);
    expect(result.artists[0]).toEqual({
      artist: "Artist X",
      imageUrl: null,
      hours: h(410_000),
      firstPlayed: "2026-01-05T10:00:00.000Z",
      lastPlayed: "2026-02-01T10:00:00.000Z",
      peakMonth: "2026-01",
      peakMonthHours: h(210_000),
    });
    expect(eras(testDb(), { range: {}, limit: 5 })).toEqual({ months: [], series: [], artists: [] });
  });
});

describe("clock and devices", () => {
  test("weekday x hour matrix in Kuwait time", () => {
    const { cells } = clock(baseFixture(), { range: {} });
    expect(cells).toHaveLength(168);
    expect(cells.find((c) => c.weekday === 1 && c.hour === 13)).toEqual({ weekday: 1, hour: 13, hours: h(200_000), plays: 1 });
    expect(cells.find((c) => c.weekday === 1 && c.hour === 15)!.plays).toBe(1);
  });

  test("device share", () => {
    const result = devices(baseFixture(), { range: {}, period: "month" });
    expect(result.totals.map((d) => [d.device, d.plays])).toEqual([
      ["ios", 3],
      ["unknown", 1],
      ["mac", 1],
    ]);
    expect(result.totals.reduce((s, d) => s + d.share!, 0)).toBeCloseTo(1, 2);
  });
});

describe("skips", () => {
  test("rates, early skips and never-skipped with thresholds", () => {
    const db = baseFixture();

    const result = skips(db, { range: {}, minPlays: 1, limit: 10 });

    expect(result.summary).toEqual({ plays: 5, skips: 2, skipRate: 0.5, earlySkips: 2, outcomes: { through: 2, early: 2, midway: 0, interrupted: 0, unknown: 1 } });
    expect(result.mostSkippedTracks.map((t) => [t.uri, t.skipRate])).toEqual([
      [C, 1],
      [A1, 0.333],
    ]);
    expect(result.earlySkips.map((t) => t.uri)).toEqual([A1, C]);
    expect(result.neverSkipped).toEqual([]);
    expect(skips(db, { range: {}, minPlays: 3, limit: 10 }).mostSkippedTracks.map((t) => t.uri)).toEqual([A1]);
  });

  test("context profile over every play with a known outcome", () => {
    const { profile } = skipContext(baseFixture(), { range: {}, weekendDays: WEEKEND });

    expect(profile.device).toEqual([
      { value: "ios", plays: 3, skips: 1, skipRate: 0.333 },
      { value: "mac", plays: 1, skips: 1, skipRate: 1 },
    ]);
    expect(profile.shuffle.find((v) => v.value === "on")).toEqual({ value: "on", plays: 1, skips: 1, skipRate: 1 });
  });

  test("an exit in the outro is played through and does not count against the song", () => {
    const db = testDb();
    seed(
      db,
      [track("p", "Song P", "Artist P", null, { durationMs: 200000 })],
      [
        play("2026-01-01T10:00:00Z", uri("p"), 170000, { skipped: true, reasonEnd: "fwdbtn" }),
        play("2026-01-01T11:00:00Z", uri("p"), 200000),
        play("2026-01-01T12:00:00Z", uri("p"), 90000, { skipped: true, reasonEnd: "backbtn" }),
      ],
    );

    const result = skips(db, { range: {}, minPlays: 1, limit: 10 });

    expect(result.summary).toMatchObject({ skips: 0, skipRate: 0, outcomes: { through: 2, early: 0, midway: 0, interrupted: 1, unknown: 0 } });
  });
});

describe("moment split", () => {
  const night = (d: number) => `2026-01-${String(d).padStart(2, "0")}T22:00:00Z`;
  const morning = (d: number) => `2026-01-${String(d).padStart(2, "0")}T06:00:00Z`;

  function splitFixture() {
    const db = testDb();
    const ids = ["w", "d", "k", "m"];
    const next = { skipped: true, reasonEnd: "fwdbtn" };
    const plays = [];
    for (let i = 1; i <= 5; i++) {
      plays.push(play(night(i), uri("w"), 200000, { reasonStart: "clickrow" }));
      plays.push(play(morning(i), uri("w"), 2000, { ...next, reasonStart: "trackdone" }));
      plays.push(play(night(i + 10), uri("d"), 2000, { ...next, reasonStart: "clickrow" }));
      plays.push(play(morning(i + 10), uri("d"), 2000, next));
    }
    for (let i = 1; i <= 10; i++) {
      plays.push(play(morning(i + 15), uri("k"), 200000, i === 1 ? next : {}));
      plays.push(play(morning(i + 15).replace("06:", "07:"), uri("m"), 50000, i % 2 === 0 ? next : {}));
    }
    seed(db, ids.map((id) => track(id, `Song ${id}`, "Artist", "Album", { durationMs: 240000 })), plays);
    return db;
  }

  test("classifies songs by how their skip rate depends on context", () => {
    const result = momentSplit(splitFixture(), { range: {}, minPlays: 8, minContextPlays: 3, limit: 10, weekendDays: WEEKEND });
    const byUri = Object.fromEntries(result.songs.map((s) => [s.uri, s.class]));
    expect(byUri).toEqual({ [uri("w")]: "wrong_moment", [uri("d")]: "skipped_everywhere", [uri("k")]: "keeper", [uri("m")]: "mixed" });
    expect(result.counts).toEqual({ keeper: 1, wrong_moment: 1, skipped_everywhere: 1, mixed: 1 });
    const w = result.songs.find((s) => s.uri === uri("w"))!;
    expect(w.bestContext).toMatchObject({ skipRate: 0, plays: 5 });
    expect(w.worstContext).toMatchObject({ skipRate: 1, plays: 5 });
  });

  test("filters by class and drops songs under the play threshold", () => {
    const db = splitFixture();
    expect(momentSplit(db, { range: {}, minPlays: 8, minContextPlays: 3, limit: 10, only: "skipped_everywhere", weekendDays: WEEKEND }).songs.map((s) => s.uri)).toEqual([uri("d")]);
    expect(momentSplit(db, { range: {}, minPlays: 11, minContextPlays: 3, limit: 10, weekendDays: WEEKEND }).eligibleSongs).toBe(0);
  });

  test("classify rules", () => {
    const ctx = (skipRate: number) => ({ dimension: "hourBucket" as const, value: "x", plays: 5, skips: 0, skipRate });
    expect(classify(0.1, [ctx(1)])).toBe("keeper");
    expect(classify(0.9, [ctx(0.2), ctx(1)])).toBe("wrong_moment");
    expect(classify(0.9, [ctx(0.9)])).toBe("skipped_everywhere");
    expect(classify(0.9, [ctx(0.2)])).toBe("mixed");
    expect(classify(0.5, [ctx(0.5)])).toBe("mixed");
  });
});

describe("recall", () => {
  test("forgotten favourites", () => {
    const db = baseFixture();
    const result = forgotten(db, { days: 90, minListens: 2, limit: 10, asOf: Date.parse("2026-06-01T00:00:00Z") });
    expect(result.items.map((t) => t.songKey)).toEqual([KEY_A]);
    expect(forgotten(db, { days: 90, minListens: 2, limit: 10, asOf: Date.parse("2026-03-01T00:00:00Z") }).items).toEqual([]);
  });

  test("on this day in earlier years", () => {
    const db = baseFixture();
    seed(db, [], [play("2025-01-05T10:00:00Z", C, 180000), play("2024-01-05T10:00:00Z", A1, 60000), play("2025-01-06T10:00:00Z", C, 180000)]);
    const result = onThisDay(db, { date: "2026-01-05", limit: 3 });
    expect(result.years.map((y) => [y.year, y.plays])).toEqual([
      [2025, 1],
      [2024, 1],
    ]);
    expect(result.years[0]!.topTracks[0]!.uri).toBe(C);
  });
});

describe("trips", () => {
  test("contiguous runs away from home, with a minimum play count", () => {
    const db = testDb();
    seed(
      db,
      [track("a1", "Song A", "Artist X", "Album 1", { albumArtUrl: "https://img/a1" })],
      [
        play("2026-01-01T10:00:00Z", A1, 200000),
        play("2026-01-02T10:00:00Z", A1, 200000, { connCountry: "GB" }),
        play("2026-01-03T10:00:00Z", A1, 200000, { connCountry: "FR" }),
        play("2026-01-04T10:00:00Z", A1, 10000, { connCountry: "GB" }),
        play("2026-01-05T10:00:00Z", A1, 200000),
        play("2026-02-01T10:00:00Z", A1, 200000, { connCountry: "SA" }),
        play("2026-02-02T10:00:00Z", A1, null),
        play("2026-02-03T10:00:00Z", A1, 200000),
      ],
    );
    const result = trips(db, { range: {}, homeCountry: "KW", minPlays: 2, topTracks: 1 });
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0]).toEqual({
      start: "2026-01-02T10:00:00.000Z",
      end: "2026-01-04T10:00:00.000Z",
      startDay: "2026-01-02",
      endDay: "2026-01-04",
      days: 3,
      countries: [
        { country: "GB", plays: 2 },
        { country: "FR", plays: 1 },
      ],
      plays: 3,
      hours: h(410_000),
      topTracks: [{ songKey: KEY_A, uri: A1, name: "Song A", artist: "Artist X", albumArtUrl: "https://img/a1", plays: 3, listens: 2, hours: h(410_000) }],
    });
    expect(trips(db, { range: {}, homeCountry: "KW", minPlays: 1, topTracks: 0 }).trips.map((t) => t.startDay)).toEqual(["2026-02-01", "2026-01-02"]);
    expect(trips(db, { range: {}, minPlays: 2, topTracks: 1 })).toEqual(result);
  });
});

describe("entity pages", () => {
  test("track page merges URIs", () => {
    const page = trackPage(baseFixture(), { uri: A2, range: {}, period: "month", weekendDays: WEEKEND })!;
    expect(page.songKey).toBe(KEY_A);
    expect(page.totals).toMatchObject({ plays: 3, listens: 2, skipRate: 0.333 });
    expect(page.uris.map((u) => [u.uri, u.plays])).toEqual([
      [A1, 2],
      [A2, 1],
    ]);
    expect(page.timeline.map((t) => t.period)).toEqual(["2026-01", "2026-02"]);
    expect(page.skipProfile.device.map((d) => [d.value, d.skipRate])).toEqual([
      ["ios", 0],
      ["mac", 1],
    ]);
    expect(page.class).toBeNull();
  });

  test("artist and album pages, and missing entities", () => {
    const db = baseFixture();
    const artist = artistPage(db, { artist: "Artist X", range: {}, period: "month", weekendDays: WEEKEND })!;
    expect(artist.totals.plays).toBe(3);
    expect(artist.tracks).toHaveLength(1);
    expect(artist.albums.map((a) => a.album)).toEqual(["Album 1", "Album 1 Deluxe"]);
    expect(albumPage(db, { artist: "Artist Y", album: "Album 2", range: {}, period: "month", weekendDays: WEEKEND })!.totals.plays).toBe(2);
    expect(artistPage(db, { artist: "Nobody", range: {}, period: "month", weekendDays: WEEKEND })).toBeNull();
    expect(trackPage(db, { uri: uri("zz"), range: {}, period: "month", weekendDays: WEEKEND })).toBeNull();
  });
});

describe("history", () => {
  test("filters, search and paging", () => {
    const db = baseFixture();
    const all = history(db, { range: {}, limit: 2, offset: 0 });
    expect(all.total).toBe(5);
    expect(all.items.map((i) => i.ts)).toEqual(["2026-03-01T10:00:00.000Z", "2026-02-01T10:00:00.000Z"]);
    expect(history(db, { range: {}, outcomes: ["early", "midway"], limit: 10, offset: 0 }).total).toBe(2);
    expect(history(db, { range: {}, q: "remastered", limit: 10, offset: 0 }).items.map((i) => i.uri)).toEqual([A2]);
    expect(history(db, { range: {}, q: "100%", limit: 10, offset: 0 }).total).toBe(0);
    expect(history(db, { range: {}, device: "mac", limit: 10, offset: 0 }).total).toBe(1);
    expect(history(db, { range: {}, songKey: KEY_A, limit: 10, offset: 0 }).total).toBe(3);
    expect(history(db, { range: {}, source: "api", limit: 10, offset: 0 }).items[0]).toMatchObject({ uri: C, msPlayed: null, outcome: null });
    expect(history(db, { range: {}, kind: "episode", limit: 10, offset: 0 }).items[0]).toMatchObject({ name: "Ep", kind: "episode" });
  });
});

describe("search", () => {
  test("finds artists, merged songs and albums by substring, most listened first", () => {
    const db = baseFixture();
    const byArtist = search(db, { q: "artist", limit: 10 });
    expect(byArtist.artists.map((a) => [a.artist, a.listens])).toEqual([
      ["Artist X", 2],
      ["Artist Y", 1],
    ]);
    expect(byArtist.songs).toEqual([]);
    const bySong = search(db, { q: "song a", limit: 10 });
    expect(bySong.songs.map((s) => [s.songKey, s.plays])).toEqual([[KEY_A, 3]]);
    expect(search(db, { q: "album 1", limit: 10 }).albums.map((a) => a.album)).toEqual(["Album 1", "Album 1 Deluxe"]);
    expect(search(db, { q: "_", limit: 10 }).artists).toEqual([]);
    expect(search(db, { q: "ep", limit: 10 }).songs).toEqual([]);
  });
});

describe("tag analytics", () => {
  test("empty but well-formed before any tags exist", () => {
    const db = baseFixture();
    expect(genreSeries(db, { range: {}, period: "month" })).toEqual({
      period: "month",
      coverage: { hoursTagged: 0, hoursTotal: h(593_000), share: 0 },
      totals: [],
      series: [],
    });
    expect(energyByHour(db, { range: {} }).hours.every((h) => h.energy === null && h.listens === 0)).toBe(true);
  });

  test("hours by genre and mood, energy by hour", () => {
    const db = baseFixture();
    const base = { energy: 4, valence: 2, language: "en", model: "m", confidence: "high" as const };
    upsertTags(db, [
      { ...base, uri: A2, genres: ["hip-hop", "jazz"], moods: ["chill"] },
      { ...base, uri: C, genres: ["pop"], moods: ["happy"], energy: 2 },
    ]);
    const genres = genreSeries(db, { range: {}, period: "month" });
    expect(genres.totals.map((g) => [g.value, g.plays])).toEqual([
      ["hip-hop", 3],
      ["jazz", 3],
      ["pop", 2],
    ]);
    expect(genres.coverage.share).toBe(1);
    expect(moodSeries(db, { range: {}, period: "year" }).series).toContainEqual({ period: "2026", value: "chill", hours: h(410_000), plays: 3 });
    const at13 = energyByHour(db, { range: {} }).hours[13]!;
    expect(at13).toEqual({ hour: 13, energy: 3.33, valence: 2, listens: 3 });
  });
});

describe("images", () => {
  test("artist rows carry the primary artist's image and songs fall back to art from any version", () => {
    const db = baseFixture();
    linkArtists(db, A1, [
      { id: "x", name: "Artist X" },
      { id: "y", name: "Artist Y" },
    ]);
    db.update(artists).set({ imageUrl: "https://img/x" }).where(eq(artists.id, "x")).run();
    db.update(artists).set({ imageUrl: "https://img/y" }).where(eq(artists.id, "y")).run();
    db.update(tracks).set({ albumArtUrl: "https://img/a2" }).where(eq(tracks.uri, A2)).run();

    expect(topArtists(db, { range: {}, limit: 5 }).map((a) => [a.artist, a.imageUrl])).toEqual([
      ["Artist X", "https://img/x"],
      ["Artist Y", null],
    ]);
    expect(artistPage(db, { artist: "Artist X", range: {}, period: "month", weekendDays: WEEKEND })!.imageUrl).toBe("https://img/x");
    expect(search(db, { q: "artist", limit: 5 }).artists.map((a) => a.imageUrl)).toEqual(["https://img/x", null]);
    expect(topTracks(db, { range: {}, limit: 1 })[0]).toMatchObject({ uri: A1, albumArtUrl: "https://img/a2" });
  });
});
