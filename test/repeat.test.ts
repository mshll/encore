import { describe, expect, test } from "bun:test";
import { onRepeat } from "../src/analytics/repeat";
import { play, seed, testDb, track, uri } from "./helpers";

const A = uri("a");
const B = uri("b");
const TRACKS = [track("a", "Song A", "Artist X", "Album", { durationMs: 200_000 }), track("b", "Song B", "Artist Y", "Album", { durationMs: 200_000 })];
const TODAY = "2026-11-15";

const listens = (trackUri: string, day: string, n: number, ms = 200_000) => Array.from({ length: n }, (_, i) => play(`${day}T${String(8 + i).padStart(2, "0")}:00:00Z`, trackUri, ms));

function db(...plays: ReturnType<typeof play>[]) {
  const d = testDb();
  seed(d, TRACKS, plays);
  return d;
}

describe("on repeat", () => {
  test("a song with five listens in the last 14 days and none before is on repeat", () => {
    const d = db(play("2026-01-01T08:00:00Z", B, 200_000), ...listens(A, "2026-11-10", 5));

    const { items } = onRepeat(d, { today: TODAY, limit: 5 });

    expect(items.map((s) => [s.name, s.listens, s.usualListens])).toEqual([["Song A", 5, 0]]);
  });

  test("four listens are too few", () => {
    const d = db(...listens(A, "2026-11-10", 4));

    expect(onRepeat(d, { today: TODAY, limit: 5 }).items).toEqual([]);
  });

  test("a song played at its usual rate is not on repeat", () => {
    const before = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].flatMap((day) => listens(A, day, 13));
    const d = db(play("2026-05-16T08:00:00Z", B, 200_000), ...before, ...listens(A, "2026-11-10", 6));

    expect(onRepeat(d, { today: TODAY, limit: 5 }).items).toEqual([]);
  });

  test("the usual scales to the days the history covers, so a short history does not inflate the lift", () => {
    const d = db(...listens(A, "2026-10-26", 6), ...listens(A, "2026-11-10", 10));

    const { items } = onRepeat(d, { today: TODAY, limit: 5 });

    expect(items).toEqual([]);
  });

  test("songs rank by listens above their usual; ties go to more listens, then the song key", () => {
    const d = db(play("2026-01-01T08:00:00Z", A, 10_000), ...listens(B, "2026-11-10", 6), ...listens(A, "2026-11-11", 6));

    const { items } = onRepeat(d, { today: TODAY, limit: 5 });

    expect(items.map((s) => s.name)).toEqual(["Song A", "Song B"]);
  });

  test("a listen on the day 14 days back counts; the day before it is the usual", () => {
    const d = db(play("2026-01-01T08:00:00Z", B, 200_000), ...listens(A, "2026-11-02", 5), ...listens(A, "2026-11-01", 1));

    const { from, items } = onRepeat(d, { today: TODAY, limit: 5 });

    expect([from, items[0]?.listens]).toEqual(["2026-11-02", 5]);
  });
});
