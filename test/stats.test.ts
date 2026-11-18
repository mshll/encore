import { describe, expect, test } from "bun:test";
import { obsessions } from "../src/analytics/obsessions";
import { encoreFinds, stayingPower } from "../src/analytics/rotation";
import { playStarts } from "../src/analytics/starts";
import { seasonal, variety } from "../src/analytics/variety";
import { calendar, listeningSessions } from "../src/analytics/when";
import type { Db } from "../src/db/client";
import { llmThreads, picks, releases, releaseTracks, setChanges, setItems, sets } from "../src/db/schema";
import { songKey } from "../src/plays/song";
import { play, seed, testDb, track, TZ, uri } from "./helpers";

const MIN = 60_000;
const A = uri("a");
const B = uri("b");
const TRACKS = [track("a", "Song A", "Artist X", "Album", { durationMs: 200_000 }), track("b", "Song B", "Artist Y", "Album", { durationMs: 200_000 })];

/** A play ending at `ts` that lasted `ms`. Kuwait is UTC+3, so 21:00Z or later is the next local day. */
const at = (ts: string, trackUri: string, ms = 200_000) => play(ts, trackUri, ms);

function db(...plays: ReturnType<typeof at>[]) {
  const d = testDb();
  seed(d, TRACKS, plays);
  return d;
}

describe("calendar", () => {
  test("empty history has no year", () => {
    const r = calendar(testDb(), {});

    expect(r).toEqual({ years: [], year: null, days: [] });
  });

  test("defaults to the latest year and keys days by local day", () => {
    const d = db(at("2025-03-01T10:00:00Z", A), at("2026-12-31T22:00:00Z", A), at("2026-05-02T10:00:00Z", B, 30 * MIN));

    const r = calendar(d, {});

    expect(r).toEqual({ years: [2025, 2026, 2027], year: 2027, days: [{ day: "2027-01-01", hours: 200_000 / 3_600_000, plays: 1 }] });
  });

  test("a year with no music has no days", () => {
    const d = db(at("2025-03-01T10:00:00Z", A));

    expect(calendar(d, { year: 2024 }).days).toEqual([]);
  });

  test("sums each day's plays and hours", () => {
    const d = db(at("2026-05-02T10:00:00Z", A, 30 * MIN), at("2026-05-02T12:00:00Z", B, 30 * MIN));

    expect(calendar(d, { year: 2026 }).days).toEqual([{ day: "2026-05-02", hours: 1, plays: 2 }]);
  });
});

describe("listening sessions", () => {
  test("empty range", () => {
    const r = listeningSessions(testDb(), { range: {} });

    expect(r).toEqual({ gapMinutes: 15, count: 0, days: 0, perDay: null, averageMinutes: null, usualStart: null, startHours: Array(24).fill(0), longest: null });
  });

  test("a gap over 15 minutes starts a new session", () => {
    const d = db(
      at("2026-05-02T10:00:00Z", A, 10 * MIN),
      at("2026-05-02T10:20:00Z", B, 10 * MIN),
      at("2026-05-02T11:00:00Z", A, 10 * MIN),
      at("2026-05-03T10:00:00Z", A, 20 * MIN),
    );

    const r = listeningSessions(d, { range: {} });

    expect([r.count, r.days, r.perDay, r.averageMinutes, r.longest?.minutes]).toEqual([3, 2, 1.5, 20, 30]);
  });

  test("a session starts at the local hour of its first play, on its local day", () => {
    const d = db(at("2026-05-02T21:30:00Z", A, 10 * MIN), at("2026-05-02T21:40:00Z", B, 10 * MIN));

    const r = listeningSessions(d, { range: {} });

    expect([r.usualStart, r.longest?.day, r.startHours[0]]).toEqual([0, "2026-05-03", 1]);
  });
});

describe("play starts", () => {
  const started = (ts: string, reasonStart: string | null, extra: Parameters<typeof play>[3] = {}) => play(ts, A, 200_000, { reasonStart, ...extra });

  test("empty range", () => {
    const r = playStarts(testDb(), { range: {} });

    expect(r.coverage).toEqual({ plays: 0, counted: 0, share: null });
  });

  test("sorts start reasons into chosen, played on, next or back, and other", () => {
    const d = db(
      started("2026-05-02T10:00:00Z", "clickrow"),
      started("2026-05-02T10:10:00Z", "playbtn"),
      started("2026-05-02T10:20:00Z", "trackdone"),
      started("2026-05-02T10:30:00Z", "fwdbtn"),
      started("2026-05-02T10:40:00Z", "backbtn"),
      started("2026-05-02T10:50:00Z", "appload"),
    );

    const { totals } = playStarts(d, { range: {} });

    expect([totals.chosen, totals.playedOn, totals.nextBack, totals.other]).toEqual([2, 1, 2, 1]);
  });

  test("API and live plays are left out of the shares and counted in coverage", () => {
    const d = db(
      started("2026-05-02T10:00:00Z", "clickrow", { shuffle: true }),
      started("2026-05-02T10:10:00Z", "trackdone"),
      play("2026-05-02T10:20:00Z", A, null),
      started("2026-05-02T10:30:00Z", "trackdone", { source: "live" }),
    );

    const r = playStarts(d, { range: {} });

    expect([r.coverage, r.totals.shares.chosen, r.totals.shares.shuffled]).toEqual([{ plays: 4, counted: 2, share: 0.5 }, 0.5, 0.5]);
  });

  test("an export play with no start reason is left out", () => {
    const d = db(started("2026-05-02T10:00:00Z", null), started("2026-05-02T10:10:00Z", "clickrow"));

    expect(playStarts(d, { range: {} }).coverage.counted).toBe(1);
  });

  test("months are local", () => {
    const d = db(started("2026-05-31T22:00:00Z", "clickrow"));

    expect(playStarts(d, { range: {} }).months.map((m) => m.month)).toEqual(["2026-06"]);
  });
});

describe("variety", () => {
  test("empty range", () => {
    expect(variety(testDb(), { range: {} })).toEqual({ topArtists: 10, weeks: [], averageArtists: null, averageTopShare: null });
  });

  test("counts artists with a listen per local week and the top 10 artists' share of its hours", () => {
    const tracks = Array.from({ length: 11 }, (_, i) => track(`v${i}`, `Song ${i}`, `Artist ${i}`, null, { durationMs: 200_000 }));
    const d = testDb();
    seed(d, [...TRACKS, ...tracks], [
      ...tracks.map((t, i) => play(`2026-05-05T10:${String(i).padStart(2, "0")}:00Z`, t.uri, i === 10 ? 60_000 : 9 * 60_000)),
      play("2026-05-05T11:00:00Z", A, 10_000),
    ]);

    const [week] = variety(d, { range: {} }).weeks;

    expect(week).toEqual({ week: "2026-05-04", artists: 11, hours: (90 * 60_000 + 60_000 + 10_000) / 3_600_000, topShare: 0.987 });
  });

  test("a Sunday night play in UTC that is Monday locally starts the next week", () => {
    const d = db(at("2026-05-10T22:00:00Z", A));

    expect(variety(d, { range: {} }).weeks.map((w) => w.week)).toEqual(["2026-05-11"]);
  });
});

describe("seasonal favourites", () => {
  /** `listens` listens of `trackUri` on the 10th of `month` (YYYY-MM), one hour each. */
  const month = (m: string, trackUri: string, listens = 1) => Array.from({ length: listens }, (_, i) => at(`${m}-10T1${i % 10}:00:00Z`, trackUri, 60 * MIN));
  /** A short play of B on the 3rd of every month of `year`, so the year has music in all 12 months. */
  const filler = (year: number) => Array.from({ length: 12 }, (_, i) => at(`${year}-${String(i + 1).padStart(2, "0")}-03T10:00:00Z`, B, 10_000));

  test("one year of history has no seasons", () => {
    const d = db(...month("2025-12", A, 6));

    expect(seasonal(d, { range: {}, limit: 10 })).toMatchObject({ artists: [], songs: [] });
  });

  test("an artist and song that peak in the same month in two years", () => {
    const d = db(...filler(2024), ...filler(2025), ...month("2024-12", A, 6), ...month("2025-12", A, 6));

    const r = seasonal(d, { range: {}, limit: 10 });

    expect([r.artists.map((a) => [a.artist, a.seasons]), r.songs.map((s) => [s.name, s.seasons])]).toEqual([
      [["Artist X", [{ month: 12, years: [2024, 2025], hours: 12 }]]],
      [["Song A", [{ month: 12, years: [2024, 2025], listens: 12 }]]],
    ]);
  });

  test("steady listening all year is not seasonal", () => {
    const year = (y: number) => Array.from({ length: 12 }, (_, i) => month(`${y}-${String(i + 1).padStart(2, "0")}`, A, 5)).flat();
    const d = db(...year(2024), ...year(2025));

    expect(seasonal(d, { range: {}, limit: 10 }).artists).toEqual([]);
  });

  test("a year with music in under six months is not judged", () => {
    const d = db(...month("2024-12", A, 6), ...month("2025-12", A, 6), ...month("2025-01", B, 1));

    expect(seasonal(d, { range: {}, limit: 10 }).artists).toEqual([]);
  });

  test("months are local: a play late on 30 November UTC counts in December", () => {
    const late = (y: number) => Array.from({ length: 5 }, () => at(`${y}-11-30T22:00:00Z`, A, 60 * MIN));
    const d = db(...filler(2024), ...filler(2025), ...late(2024), ...late(2025));

    expect(seasonal(d, { range: {}, limit: 10 }).songs[0]?.seasons.map((s) => s.month)).toEqual([12]);
  });
});

const listen = (day: string, trackUri = A) => at(`${day}T10:00:00Z`, trackUri);

describe("staying power", () => {
  const today = "2026-12-31";

  test("empty range", () => {
    const r = stayingPower(testDb(), { range: {}, today, limit: 5 });

    expect([r.songs, r.inRotation, r.medianDays, r.longest]).toEqual([0, 0, null, []]);
  });

  test("a run ends at the last listen before a gap of more than 30 days", () => {
    const d = db(listen("2026-01-01"), listen("2026-01-20"), listen("2026-02-15"), listen("2026-05-01"));

    const [run] = stayingPower(d, { range: {}, today, limit: 5 }).longest;

    expect(run).toMatchObject({ from: "2026-01-01", to: "2026-02-15", days: 46, activeDays: 3, listens: 3, ongoing: false });
  });

  test("a song heard on one day never entered rotation", () => {
    const d = db(listen("2026-01-01"), at("2026-01-01T12:00:00Z", A), listen("2026-03-01", B), listen("2026-03-02", B));

    const r = stayingPower(d, { range: {}, today, limit: 5 });

    expect([r.songs, r.inRotation, r.medianDays, r.buckets[0]!.songs]).toEqual([2, 1, 2, 1]);
  });

  test("only songs first heard in the range count", () => {
    const d = db(listen("2025-12-01"), listen("2026-01-02"), listen("2026-01-05", B), listen("2026-01-06", B));

    expect(stayingPower(d, { range: { from: "2026-01-01" }, today, limit: 5 }).longest.map((r) => r.name)).toEqual(["Song B"]);
  });

  test("a run still within 30 days of today is ongoing", () => {
    const d = db(listen("2026-12-01"), listen("2026-12-20"));

    expect(stayingPower(d, { range: {}, today, limit: 5 }).longest[0]?.ongoing).toBe(true);
  });
});

describe("what encore found", () => {
  const KEY_A = songKey("Song A", "Artist X");
  const KEY_B = songKey("Song B", "Artist Y");
  const ts = (iso: string) => Date.parse(iso);

  function pick(d: Db, key: string, trackUri: string, createdAt: number) {
    d.insert(picks).values({ week: "2026-05-04", position: 1, uri: trackUri, songKey: key, name: "Song", artist: "Artist", reason: "r", distance: "near", stateAt: createdAt, createdAt }).run();
  }

  function newInSet(d: Db, key: string, trackUri: string, createdAt: number) {
    const thread = d.insert(llmThreads).values({ feature: "sets", system: "", messages: [], createdAt, updatedAt: createdAt }).returning().get();
    const set = d.insert(sets).values({ threadId: thread.id, request: "r", title: "t", description: "", version: 1, createdAt, updatedAt: createdAt }).returning().get();
    d.insert(setItems).values({ setId: set.id, position: 0, kind: "new", songKey: key, uri: trackUri, name: "Song", artist: "Artist", reason: "r" }).run();
    return set.id;
  }

  test("nothing suggested", () => {
    expect(encoreFinds(testDb(), { range: {}, timezone: TZ, limit: 10 })).toEqual({ suggested: 0, heardBefore: 0, listened: 0, listens: 0, hours: 0, items: [] });
  });

  test("a song listened to before its suggestion is left out", () => {
    const d = db(listen("2026-05-10"), listen("2026-05-11"));
    pick(d, KEY_A, A, ts("2026-05-10T12:00:00Z"));

    const r = encoreFinds(d, { range: {}, timezone: TZ, limit: 10 });

    expect([r.suggested, r.heardBefore, r.listened]).toEqual([0, 1, 0]);
  });

  test("only listens after the suggestion count", () => {
    const d = db(at("2026-05-10T10:00:00Z", A, 10_000), listen("2026-05-11"));
    pick(d, KEY_A, A, ts("2026-05-10T12:00:00Z"));

    const r = encoreFinds(d, { range: {}, timezone: TZ, limit: 10 });

    expect([r.suggested, r.listens]).toEqual([1, 1]);
  });

  test("a song suggested twice counts from its first suggestion, with both sources", () => {
    const d = db(listen("2026-05-12"), listen("2026-05-20"));
    newInSet(d, KEY_A, A, ts("2026-05-15T00:00:00Z"));
    pick(d, KEY_A, A, ts("2026-05-11T00:00:00Z"));

    const [item] = encoreFinds(d, { range: {}, timezone: TZ, limit: 10 }).items;

    expect(item).toMatchObject({ sources: ["picks", "sets"], suggested: "2026-05-11", listens: 2, firstListen: "2026-05-12" });
  });

  test("a set song added in a later version counts from the change that added it", () => {
    const d = db(listen("2026-05-12"), listen("2026-05-20"));
    const setId = newInSet(d, KEY_A, A, ts("2026-05-01T00:00:00Z"));
    d.insert(setChanges).values({ setId, version: 2, source: "claude", added: [{ songKey: KEY_A, name: "Song A", artist: "Artist X" }], removed: [], moved: [], createdAt: ts("2026-05-15T00:00:00Z") }).run();

    const r = encoreFinds(d, { range: {}, timezone: TZ, limit: 10 });

    expect([r.heardBefore, r.items[0]?.listens]).toEqual([1, undefined]);
  });

  test("release tracks count from when encore first saw the release", () => {
    const d = db(listen("2026-05-20", B));
    d.insert(releases).values({ id: "r1", uri: "spotify:album:r1", artistId: "a1", artistName: "Artist Y", name: "Album", albumType: "album", releaseDate: "2026-05-15", firstSeenAt: ts("2026-05-16T00:00:00Z"), isNew: true }).run();
    d.insert(releaseTracks).values({ releaseId: "r1", position: 0, uri: B, songKey: KEY_B, name: "Song B", artist: "Artist Y" }).run();

    const [item] = encoreFinds(d, { range: {}, timezone: TZ, limit: 10 }).items;

    expect(item).toMatchObject({ sources: ["releases"], suggested: "2026-05-16", listens: 1 });
  });

  test("the range picks suggestions by their local day", () => {
    const d = db(listen("2026-06-02"));
    pick(d, KEY_A, A, ts("2026-05-31T22:00:00Z"));

    expect(encoreFinds(d, { range: { from: "2026-06-01" }, timezone: TZ, limit: 10 }).suggested).toBe(1);
  });
});

describe("obsessions", () => {
  const today = "2026-12-31";
  /** `n` listens of `trackUri` on each local day from `from` for `days` days. */
  const daily = (from: string, days: number, n: number, trackUri = A) =>
    Array.from({ length: days }, (_, d) => Array.from({ length: n }, (_, i) => at(new Date(Date.parse(`${from}T08:00:00Z`) + d * 86_400_000 + i * 600_000).toISOString(), trackUri))).flat();

  test("empty range", () => {
    expect(obsessions(testDb(), { range: {}, today, limit: 10 }).items).toEqual([]);
  });

  test("a burst far above the usual rate that faded", () => {
    const d = db(...daily("2026-01-01", 1, 1), ...daily("2026-03-01", 4, 3), ...daily("2026-08-01", 1, 1));

    const items = obsessions(d, { range: {}, today, limit: 10 }).items;

    expect(items.map((o) => [o.name, o.from, o.to, o.listens, o.after])).toEqual([["Song A", "2026-03-01", "2026-03-04", 12, 0]]);
  });

  test("a song played as much every week is not an obsession", () => {
    const d = db(...Array.from({ length: 20 }, (_, w) => daily(new Date(Date.parse("2026-01-05") + w * 7 * 86_400_000).toISOString().slice(0, 10), 2, 4)).flat());

    expect(obsessions(d, { range: {}, today, limit: 10 }).items).toEqual([]);
  });

  test("a burst that kept going is not faded", () => {
    const d = db(...daily("2026-03-01", 4, 3), ...daily("2026-03-10", 3, 2));

    expect(obsessions(d, { range: {}, today, limit: 10 }).items).toEqual([]);
  });

  test("a burst within the last 28 days cannot have faded yet", () => {
    const d = db(...daily("2026-12-20", 4, 3));

    expect(obsessions(d, { range: {}, today, limit: 10 }).items).toEqual([]);
  });

  test("burst days are local and the range picks bursts by their first day", () => {
    const d = db(...daily("2026-02-28", 3, 3).map((p) => ({ ...p, ts: p.ts + 14 * 3_600_000 })));

    const items = obsessions(d, { range: { from: "2026-03-01" }, today, limit: 10 }).items;

    expect(items.map((o) => o.from)).toEqual(["2026-03-01"]);
  });
});
