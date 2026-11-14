import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { MUSIC, OUTCOME, playOutcome, type OutcomeInput, type PlayOutcome } from "../src/analytics/common";
import { momentSplit, skips } from "../src/analytics/skips";
import { loadLibrary } from "../src/library/analysis";
import { computeProposals } from "../src/library/rules";
import { refreshPickOutcomes } from "../src/picks/outcomes";
import { picks, savedTracks } from "../src/db/schema";
import { songKey } from "../src/plays/song";
import { play, seed, testDb, track, TZ, uri, WEEKEND } from "./helpers";

type Case = [label: string, input: OutcomeInput, expected: PlayOutcome | null];

const next = (msPlayed: number | null, durationMs: number | null): OutcomeInput => ({ reasonEnd: "fwdbtn", msPlayed, durationMs });

const CASES: Case[] = [
  ["the song ended by itself", { reasonEnd: "trackdone", msPlayed: 10_000, durationMs: 200_000 }, "through"],
  ["the song ended by itself, length unknown", { reasonEnd: "trackdone", msPlayed: null, durationMs: null }, "through"],
  ["next at 80%", next(160_000, 200_000), "through"],
  ["next at 79%", next(158_000, 200_000), "midway"],
  ["next with 30 s left of a 2-minute song", next(90_000, 120_000), "through"],
  ["next with 31 s left of a 2-minute song", next(89_000, 120_000), "midway"],
  ["next at 30 s", next(30_000, 200_000), "midway"],
  ["next at 29 s", next(29_000, 200_000), "early"],
  ["next at 29 s of a 40 s song: the outro never reaches into the first 30 s", next(29_000, 40_000), "early"],
  ["next at 30 s of a 40 s song", next(30_000, 40_000), "through"],
  ["next at 80% of a 20 s song", next(16_000, 20_000), "through"],
  ["next past the end after a seek or repeat", next(250_000, 200_000), "through"],
  ["next at 10 s, length unknown", next(10_000, null), "early"],
  ["next at 100 s, length unknown", next(100_000, null), null],
  ["next at 100 s, length stored as 0", next(100_000, 0), null],
  ["next with no time played recorded", next(null, 200_000), null],
  ["no reason recorded (recently-played API row)", { reasonEnd: null, msPlayed: null, durationMs: 200_000 }, null],
  ...(["backbtn", "endplay", "logout", "remote", "trackerror", "unexpected-exit", "unexpected-exit-while-paused", "clickrow"] as const).map(
    (reasonEnd): Case => [`ended by ${reasonEnd}`, { reasonEnd, msPlayed: 5_000, durationMs: 200_000 }, "interrupted"],
  ),
];

describe("play outcome", () => {
  test.each(CASES)("%s", (_label, input, expected) => {
    const outcome = playOutcome(input);

    expect(outcome).toBe(expected);
  });

  test("the SQL definition agrees with the TypeScript one on every case", () => {
    const db = testDb();
    seed(
      db,
      CASES.map(([, input], i) => track(`t${i}`, `Song ${i}`, "Artist", null, input.durationMs === null ? {} : { durationMs: input.durationMs })),
      CASES.map(([, input], i) =>
        play(`2026-01-01T10:${String(i).padStart(2, "0")}:00Z`, uri(`t${i}`), input.msPlayed, { reasonEnd: input.reasonEnd, source: input.reasonEnd === null ? "api" : "export" }),
      ),
    );

    const rows = db.all<{ name: string; outcome: PlayOutcome | null }>(sql`select t.name, ${OUTCOME} as outcome from ${MUSIC} order by p.ts`);

    expect(rows.map((r) => r.outcome)).toEqual(CASES.map(([, input]) => playOutcome(input)));
  });
});

describe("outro exits never count against a song", () => {
  const day = (d: number, hour = 10) => `2026-01-${String(d).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
  const outro = (ts: string, id: string) => play(ts, uri(id), 185_000, { skipped: true, reasonEnd: "fwdbtn" });

  function outroFixture() {
    const db = testDb();
    seed(
      db,
      [track("o", "Outro", "Artist", null, { durationMs: 200_000 })],
      Array.from({ length: 10 }, (_, i) => outro(day(i + 1, i % 2 ? 22 : 6), "o")),
    );
    return db;
  }

  test("a song left in its outro every time has no skips", () => {
    const result = skips(outroFixture(), { range: {}, minPlays: 1, limit: 10 });

    expect(result.summary).toMatchObject({ skips: 0, skipRate: 0, outcomes: { through: 10 } });
  });

  test("a song left in its outro every time is a keeper, in every context", () => {
    const split = momentSplit(outroFixture(), { range: {}, minPlays: 8, minContextPlays: 3, limit: 10, weekendDays: WEEKEND });

    expect(split.songs.map((s) => s.class)).toEqual(["keeper"]);
  });

  test("the library counts outro exits as played through", () => {
    const library = loadLibrary(outroFixture(), Date.parse("2026-02-01T00:00:00Z"), { timezone: TZ });

    expect([...library.stats.values()].map((s) => [s.finished, s.finishKnown])).toEqual([[10, 10]]);
  });

  test("no rule plan takes out a liked song left in its outro, even out of rotation", () => {
    const db = outroFixture();
    db.insert(savedTracks).values({ uri: uri("o"), addedAt: Date.parse("2025-01-01T00:00:00Z"), syncedAt: Date.parse("2026-11-01T00:00:00Z") }).run();

    const proposals = computeProposals(db, Date.parse("2026-11-01T00:00:00Z"), { timezone: TZ, weekendDays: WEEKEND });

    expect(proposals).toEqual([]);
  });

  test("a pick left in its outro counts as played through", () => {
    const db = outroFixture();
    db.insert(picks)
      .values({ week: "2025-W52", position: 1, songKey: songKey("Outro", "Artist"), uri: uri("o"), name: "Outro", artist: "Artist", reason: "r", distance: "near", stateAt: 0, createdAt: Date.parse("2025-12-31T00:00:00Z") })
      .run();

    refreshPickOutcomes(db);

    expect(db.select({ plays: picks.plays, finished: picks.finished }).from(picks).all()).toEqual([{ plays: 10, finished: 10 }]);
  });
});

describe("plays without a known ending", () => {
  test("recently-played API rows count as listens but stay out of the skip rate", () => {
    const db = testDb();
    seed(db, [track("a", "A", "Artist", null, { durationMs: 200_000 })], [play("2026-01-01T10:00:00Z", uri("a"), null), play("2026-01-01T11:00:00Z", uri("a"), 5_000, { skipped: true })]);

    const { summary } = skips(db, { range: {}, minPlays: 1, limit: 10 });

    expect(summary).toEqual({ plays: 2, skips: 1, skipRate: 1, earlySkips: 1, outcomes: { through: 0, early: 1, midway: 0, interrupted: 0, unknown: 1 } });
  });

  test("next after 30 seconds of a song of unknown length stays out of the skip rate", () => {
    const db = testDb();
    seed(db, [track("a", "A", "Artist", null)], [play("2026-01-01T10:00:00Z", uri("a"), 100_000, { skipped: true }), play("2026-01-01T11:00:00Z", uri("a"), 200_000)]);

    const { summary } = skips(db, { range: {}, minPlays: 1, limit: 10 });

    expect(summary).toMatchObject({ skips: 0, skipRate: 0, outcomes: { through: 1, unknown: 1 } });
  });
});
