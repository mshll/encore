import { describe, expect, test } from "bun:test";
import { decades } from "../src/analytics/decades";
import { comebacks, discovery, loyalty, monthDiscoveries, periodDiscovery } from "../src/analytics/discovery";
import { podcasts } from "../src/analytics/podcasts";
import { currentStreak, milestones, records, recordsSetIn, streaks, weekHighlight } from "../src/analytics/records";
import { yearCompare } from "../src/analytics/years";
import { recapFacts } from "../src/digest/facts";
import { songKey } from "../src/plays/song";
import { upsertTags } from "../src/tags/service";
import { play, seed, testDb, track, uri } from "./helpers";

const HOUR = 3_600_000;
const A = uri("a");
const B = uri("b");
const C = uri("c");
const TRACKS = [
  track("a", "Song A", "Artist X", "Album", { durationMs: 200_000, releaseDate: "1994-05-01" }),
  track("b", "Song B", "Artist Y", "Album", { durationMs: 200_000, releaseDate: "2016" }),
  track("c", "Song C", "Artist Z", "Album", { durationMs: 200_000 }),
];

/** A play ending at `ts` that lasted `ms`. Kuwait is UTC+3, so 21:00Z or later is the next local day. */
const at = (ts: string, trackUri: string, ms = 200_000) => play(ts, trackUri, ms);

function db(...plays: ReturnType<typeof at>[]) {
  const d = testDb();
  seed(d, TRACKS, plays);
  return d;
}

describe("discovery", () => {
  test("empty history", () => {
    expect(discovery(testDb(), { range: {} })).toEqual({ historyStart: null, months: [], totals: { hours: 0, newHours: 0, newShare: null, newArtists: 0, newSongs: 0 } });
  });

  test("counts first plays per month and the share of hours on songs first heard that month, leaving out the first month", () => {
    const d = db(at("2026-01-10T10:00:00Z", A, HOUR), at("2026-02-03T10:00:00Z", A, HOUR), at("2026-02-04T10:00:00Z", B, HOUR), at("2026-02-05T10:00:00Z", B, HOUR));
    const r = discovery(d, { range: {} });
    expect(r.historyStart).toBe("2026-01-10");
    expect(r.months).toEqual([{ month: "2026-02", hours: 3, newHours: 2, newShare: 0.667, newArtists: 1, newSongs: 1 }]);
  });

  test("a first play late on the last evening of a month belongs to the next local month", () => {
    const d = db(at("2026-01-10T10:00:00Z", A), at("2026-01-31T22:00:00Z", B));
    expect(discovery(d, { range: {} }).months.map((m) => [m.month, m.newSongs])).toEqual([["2026-02", 1]]);
  });

  test("lists a month's discoveries with what they came to since", () => {
    const d = db(at("2026-01-10T10:00:00Z", A), at("2026-02-03T10:00:00Z", B, HOUR), at("2026-04-03T10:00:00Z", B, HOUR));
    const r = monthDiscoveries(d, { month: "2026-02", limit: 10 });
    expect(r.artists).toEqual([{ artist: "Artist Y", firstDay: "2026-02-03", hours: 1, listens: 1, songs: 1, hoursSince: 2, imageUrl: null }]);
    expect(r.songs.map((s) => [s.name, s.firstDay, s.hours, s.hoursSince, s.listensSince])).toEqual([["Song B", "2026-02-03", 1, 2, 2]]);
    expect(monthDiscoveries(d, { month: "2026-03", limit: 10 })).toEqual({ month: "2026-03", artists: [], songs: [] });
  });

  test("recap discovery is null when the history starts inside the period", () => {
    const d = db(at("2026-01-10T10:00:00Z", A, HOUR), at("2026-02-03T10:00:00Z", B, HOUR));
    expect(periodDiscovery(d, { from: "2026-01-01", to: "2026-01-31" })).toBeNull();
    expect(periodDiscovery(d, { from: "2026-02-01", to: "2026-02-28" })).toEqual({ newSongs: 1, newArtists: 1, newHours: 1, newShare: 1 });
  });
});

/** Every month from `from` for `count` months gets one hour of `trackUri` on the 10th. */
function monthly(from: string, count: number, trackUri: string, ms = HOUR) {
  const [y, m] = from.split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => at(new Date(Date.UTC(y, m - 1 + i, 10, 10)).toISOString(), trackUri, ms));
}

describe("comebacks", () => {
  test("an artist played, gone for six active months, then back", () => {
    const d = db(...monthly("2025-01", 4, A), ...monthly("2025-01", 16, B), ...monthly("2025-11", 2, A));
    const r = comebacks(d, { range: {}, limit: 10 });
    expect(r.items).toEqual([
      { artist: "Artist X", imageUrl: null, lastBefore: "2025-04-10", returned: "2025-11-10", gapMonths: 6, gapDays: 214, hoursBefore: 4, hoursSince: 2 },
    ]);
  });

  test("months with no listening at all do not count toward the gap", () => {
    const d = db(...monthly("2025-01", 4, A), ...monthly("2025-11", 2, A));
    expect(comebacks(d, { range: {}, limit: 10 }).items).toEqual([]);
  });

  test("a gap of five months, a small before, or a blip back is no comeback", () => {
    const five = db(...monthly("2025-01", 4, A), ...monthly("2025-01", 15, B), ...monthly("2025-10", 2, A));
    expect(comebacks(five, { range: {}, limit: 10 }).items).toEqual([]);
    const small = db(...monthly("2025-01", 2, A), ...monthly("2025-01", 16, B), ...monthly("2025-11", 2, A));
    expect(comebacks(small, { range: {}, limit: 10 }).items).toEqual([]);
    const blip = db(...monthly("2025-01", 4, A), ...monthly("2025-01", 16, B), ...monthly("2025-11", 1, A, 0.5 * HOUR));
    expect(comebacks(blip, { range: {}, limit: 10 }).items).toEqual([]);
  });

  test("plays under the floor inside the gap do not end it, and the range filters by the return day", () => {
    const d = db(...monthly("2025-01", 4, A), ...monthly("2025-01", 16, B), ...monthly("2025-07", 1, A, 600_000), ...monthly("2025-11", 2, A));
    expect(comebacks(d, { range: {}, limit: 10 }).items).toHaveLength(1);
    expect(comebacks(d, { range: { to: "2025-10-31" }, limit: 10 }).items).toEqual([]);
  });
});

describe("loyalty", () => {
  test("years over the floor and the longest run of consecutive ones", () => {
    const year = (y: number, trackUri: string, h = 3) => Array.from({ length: h }, (_, i) => at(`${y}-03-0${i + 1}T10:00:00Z`, trackUri, HOUR));
    const d = db(...year(2021, A), ...year(2022, A), ...year(2024, A), ...year(2025, A), ...year(2026, A), ...year(2021, B), ...year(2022, B, 1));
    const r = loyalty(d, { range: {}, limit: 10 });
    expect(r.years).toEqual([2021, 2022, 2024, 2025, 2026]);
    expect(r.items).toEqual([{ artist: "Artist X", imageUrl: null, years: [2021, 2022, 2024, 2025, 2026], hours: 15, run: { from: 2024, to: 2026, years: 3 } }]);
  });

  test("empty history", () => {
    expect(loyalty(testDb(), { range: {}, limit: 10 })).toMatchObject({ years: [], items: [] });
  });
});

describe("streaks", () => {
  test("current reaches yesterday, longest is the longest run in the range, by local day", () => {
    const d = db(
      at("2026-01-01T10:00:00Z", A),
      at("2026-01-02T10:00:00Z", A),
      at("2026-01-03T10:00:00Z", A),
      at("2026-01-03T22:00:00Z", B),
      at("2026-01-10T10:00:00Z", B),
      at("2026-01-11T10:00:00Z", B),
    );
    const r = streaks(d, { range: {}, today: "2026-01-12" });
    expect(r.longest).toEqual({ days: 4, from: "2026-01-01", to: "2026-01-04" });
    expect(r.current).toEqual({ days: 2, from: "2026-01-10", to: "2026-01-11" });
    expect(r.artists.map((a) => [a.artist, a.days])).toEqual([
      ["Artist X", 3],
      ["Artist Y", 2],
    ]);
    expect(currentStreak(d, "2026-01-13")).toBeNull();
  });

  test("a day of only short plays has no listen and breaks the streak", () => {
    const d = db(at("2026-01-01T10:00:00Z", A), at("2026-01-02T10:00:00Z", A, 5_000), at("2026-01-03T10:00:00Z", A));
    expect(streaks(d, { range: {}, today: "2026-01-03" }).longest).toEqual({ days: 1, from: "2026-01-01", to: "2026-01-01" });
  });

  test("empty history and a single day", () => {
    expect(streaks(testDb(), { range: {}, today: "2026-01-01" })).toEqual({ today: "2026-01-01", current: null, longest: null, artists: [] });
    expect(streaks(db(at("2026-01-01T10:00:00Z", A)), { range: {}, today: "2026-01-01" })).toMatchObject({ current: { days: 1 }, longest: { days: 1 }, artists: [] });
  });
});

describe("records", () => {
  test("biggest day, week, month, song in a day and the longest session", () => {
    const d = db(
      at("2026-01-05T10:00:00Z", A),
      at("2026-01-05T10:13:20Z", A),
      at("2026-01-05T10:30:00Z", B),
      at("2026-01-05T12:00:00Z", B),
      at("2026-02-01T10:00:00Z", B, 2 * HOUR),
    );
    const r = records(d, { range: {} });
    expect(r.day).toEqual({ day: "2026-02-01", hours: 2 });
    expect(r.week).toEqual({ week: "2026-01-26", hours: 2 });
    expect(r.month).toEqual({ month: "2026-02", hours: 2 });
    expect(r.songDay).toMatchObject({ day: "2026-01-05", listens: 2, song: { name: "Song A" } });
    expect(r.session).toEqual({ start: "2026-02-01T08:00:00.000Z", end: "2026-02-01T10:00:00.000Z", day: "2026-02-01", minutes: 120, hours: 2, plays: 1 });
    expect(r.sessionGapMinutes).toBe(15);
  });

  test("a gap of more than 15 minutes between one play's end and the next one's start ends a session", () => {
    const d = db(at("2026-01-05T10:00:00Z", A), at("2026-01-05T10:18:20Z", A), at("2026-01-05T10:40:00Z", A));
    expect(records(d, { range: {} }).session).toMatchObject({ minutes: 22, plays: 2 });
  });

  test("empty range", () => {
    expect(records(testDb(), { range: {} })).toEqual({ sessionGapMinutes: 15, day: null, week: null, month: null, songDay: null, session: null });
  });

  test("records set inside a span", () => {
    const d = db(at("2026-01-05T10:00:00Z", A), at("2026-02-01T10:00:00Z", B, 2 * HOUR));
    expect(recordsSetIn(d, { from: "2026-02-01", to: "2026-02-07" }).map((r) => r.record)).toEqual(["day", "session", "week", "month"]);
    expect(recordsSetIn(d, { from: "2026-03-01", to: "2026-03-07" })).toEqual([]);
  });
});

describe("milestones", () => {
  test("a song's 10th listen, an artist's 10th hour and the 100th hour, newest first, in range", () => {
    const listens = Array.from({ length: 10 }, (_, i) => at(`2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`, A));
    const hoursOfY = Array.from({ length: 10 }, (_, i) => at(`2026-02-${String(i + 1).padStart(2, "0")}T10:00:00Z`, B, 10 * HOUR));
    const r = milestones(db(...listens, ...hoursOfY), { range: {}, limit: 10 });

    expect(r.items).toEqual([
      { kind: "total", threshold: 100, day: "2026-02-10" },
      { kind: "artist", threshold: 100, day: "2026-02-10", artist: "Artist Y", imageUrl: null },
      { kind: "song", threshold: 10, day: "2026-02-10", song: { songKey: songKey("Song B", "Artist Y"), uri: B, name: "Song B", artist: "Artist Y", albumArtUrl: null } },
      { kind: "artist", threshold: 50, day: "2026-02-05", artist: "Artist Y", imageUrl: null },
      { kind: "artist", threshold: 10, day: "2026-02-01", artist: "Artist Y", imageUrl: null },
      { kind: "song", threshold: 10, day: "2026-01-10", song: { songKey: songKey("Song A", "Artist X"), uri: A, name: "Song A", artist: "Artist X", albumArtUrl: null } },
    ]);
    expect(milestones(db(...listens, ...hoursOfY), { range: { to: "2026-01-31" }, limit: 10 }).items.map((m) => m.kind)).toEqual(["song"]);
  });

  test("short plays are not listens", () => {
    const plays = Array.from({ length: 10 }, (_, i) => at(`2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`, A, i === 0 ? 5_000 : 200_000));
    expect(milestones(db(...plays), { range: {}, limit: 10 }).items).toEqual([]);
  });
});

describe("week highlight", () => {
  test("a record set this week wins once the history is four weeks old", () => {
    const d = db(at("2025-12-01T10:00:00Z", A), at("2026-01-05T10:00:00Z", B, 2 * HOUR));
    expect(weekHighlight(d, { from: "2026-01-02", today: "2026-01-05" })).toMatchObject({ kind: "record", record: "day", day: "2026-01-05", hours: 2 });
  });

  test("a young history gives no record; a milestone or a week-long streak instead; else null", () => {
    const young = db(at("2026-01-03T10:00:00Z", A), at("2026-01-05T10:00:00Z", B, 2 * HOUR));
    expect(weekHighlight(young, { from: "2026-01-02", today: "2026-01-05" })).toBeNull();
    const week = Array.from({ length: 7 }, (_, i) => at(`2026-01-0${i + 1}T10:00:00Z`, A));
    expect(weekHighlight(db(...week), { from: "2026-01-05", today: "2026-01-07" })).toEqual({ kind: "streak", days: 7, from: "2026-01-01", to: "2026-01-07" });
    expect(weekHighlight(testDb(), { from: "2026-01-05", today: "2026-01-07" })).toBeNull();
  });
});

describe("decades and listening age", () => {
  test("hours by release decade and the time-weighted median release year, leaving undated songs out", () => {
    const d = db(at("2026-01-05T10:00:00Z", A, HOUR), at("2026-01-05T12:00:00Z", B, 2 * HOUR), at("2026-01-05T14:00:00Z", C, HOUR));
    expect(decades(d, { range: {} })).toEqual({
      decades: [
        { decade: 1990, hours: 1, plays: 1, share: 0.333 },
        { decade: 2010, hours: 2, plays: 1, share: 0.667 },
      ],
      listeningAge: 2016,
      coverage: { hoursDated: 3, hoursTotal: 4, share: 0.75, playsShare: 0.667 },
    });
  });

  test("no release dates", () => {
    expect(decades(db(at("2026-01-05T10:00:00Z", C)), { range: {} })).toMatchObject({ decades: [], listeningAge: null, coverage: { share: 0 } });
    expect(decades(testDb(), { range: {} })).toMatchObject({ listeningAge: null, coverage: { share: null } });
  });
});

describe("year against year", () => {
  test("totals, new artists, rank change and tag shares", () => {
    const d = db(
      at("2025-03-01T10:00:00Z", A, 2 * HOUR),
      at("2025-03-02T10:00:00Z", B, HOUR),
      at("2026-03-01T10:00:00Z", B, 3 * HOUR),
      at("2026-03-02T10:00:00Z", A, HOUR),
      at("2026-03-03T10:00:00Z", C, HOUR),
    );
    upsertTags(d, [{ uri: B, genres: ["rock"], moods: ["calm"], energy: 3, valence: 3, language: "en", model: "m", confidence: "high" }]);
    const r = yearCompare(d, { a: 2025, b: 2026 });
    expect(r.years).toEqual([2025, 2026]);
    expect(r.a).toEqual({ year: 2025, hours: 3, plays: 2, listens: 2, artists: 2, songs: 2, newArtists: 2, newSongs: 2 });
    expect(r.b).toMatchObject({ year: 2026, hours: 5, newArtists: 1, newSongs: 1 });
    expect(r.artists.map((x) => [x.artist, x.a?.rank ?? null, x.b?.rank ?? null, x.change])).toEqual([
      ["Artist Y", 2, 1, 1],
      ["Artist X", 1, 2, -1],
      ["Artist Z", null, 3, null],
    ]);
    expect(r.genres).toEqual([{ value: "rock", a: 1, b: 1 }]);
  });

  test("the year before's top artists that fell out follow in their rank this year", () => {
    const d = testDb();
    const ids = [...Array(10).keys()].map((i) => `n${i}`);
    seed(
      d,
      [track("f1", "F1", "Faller 1", null), track("f2", "F2", "Faller 2", null), ...ids.map((id) => track(id, id, `New ${id}`, null))],
      [
        at("2025-03-01T10:00:00Z", uri("f1"), 3 * HOUR),
        at("2025-03-02T10:00:00Z", uri("f2"), 2 * HOUR),
        ...ids.map((id, i) => at(`2026-03-${String(i + 1).padStart(2, "0")}T10:00:00Z`, uri(id), (20 - i) * HOUR)),
        at("2026-04-01T10:00:00Z", uri("f2"), 2 * HOUR),
        at("2026-04-02T10:00:00Z", uri("f1"), HOUR),
      ],
    );
    const r = yearCompare(d, { a: 2025, b: 2026 });
    expect(r.artists.slice(10).map((x) => [x.artist, x.b?.rank])).toEqual([
      ["Faller 2", 11],
      ["Faller 1", 12],
    ]);
  });
});

describe("podcasts", () => {
  test("hours by show and recent episodes, music left out", () => {
    const d = testDb();
    const episode = (ts: string, show: string, name: string, ms: number) =>
      play(ts, null as unknown as string, ms, { kind: "episode", episodeUri: `spotify:episode:${name}`, episodeName: name, showName: show });
    seed(d, TRACKS, [episode("2026-01-05T10:00:00Z", "Show 1", "e1", HOUR), episode("2026-01-06T10:00:00Z", "Show 1", "e2", HOUR), episode("2026-01-07T10:00:00Z", "Show 2", "e3", 1_800_000), at("2026-01-07T12:00:00Z", A)]);
    const r = podcasts(d, { range: {}, limit: 10 });
    expect(r.hours).toBe(2.5);
    expect(r.plays).toBe(3);
    expect(r.shows.map((s) => [s.show, s.hours, s.episodes])).toEqual([
      ["Show 1", 2, 2],
      ["Show 2", 0.5, 1],
    ]);
    expect(r.recent[0]).toEqual({ ts: "2026-01-07T10:00:00.000Z", day: "2026-01-07", show: "Show 2", episode: "e3", uri: "spotify:episode:e3", minutes: 30 });
    expect(podcasts(testDb(), { range: {}, limit: 10 })).toEqual({ hours: 0, plays: 0, shows: [], recent: [] });
  });
});

describe("recap facts", () => {
  test("carry the period's discovery, comebacks, records, streak and milestones", () => {
    const d = db(...monthly("2025-01", 4, A), ...monthly("2025-01", 16, B), ...monthly("2025-11", 1, A, 7 * HOUR));

    const facts = recapFacts(d, "monthly", { from: "2025-11-01", to: "2025-11-30", inProgress: false }, null);

    expect(facts.discovery).toEqual({ newSongs: 0, newArtists: 0, newHours: 0, newShare: 0 });
    expect(facts.comebacks?.map((c) => c.artist)).toEqual(["Artist X"]);
    expect(facts.records?.map((r) => r.record)).toEqual(["day", "session", "week", "month"]);
    expect(facts.streak).toEqual({ days: 1, from: "2025-11-10", to: "2025-11-10" });
    expect(facts.milestones?.map((m) => [m.kind, m.threshold])).toEqual([["artist", 10]]);
  });
});
