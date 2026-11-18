import { describe, expect, test } from "bun:test";
import { hours as h } from "../src/analytics/common";
import { weekSoFar } from "../src/analytics/week";
import { play, seed, testDb, track, uri } from "./helpers";

const A = uri("a");
const SONG = track("a", "Song A", "Artist X", "Album", { durationMs: 200_000 });
/** Recaps written on Friday: weeks run Friday to Thursday. Sunday 15 Nov 2026, 14:00 in Kuwait (UTC+3). */
const FRIDAY = 5;
const NOW = { day: "2026-11-15", hour: 14, weekday: 7 };

const full = (ts: string) => play(ts, A, 200_000);

describe("week so far", () => {
  test("starts the week at local midnight on the recap weekday, not at UTC midnight", () => {
    const db = testDb();
    seed(db, [SONG], [full("2026-11-12T20:30:00Z"), full("2026-11-12T21:30:00Z")]);
    const week = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });
    expect(week).toMatchObject({ from: "2026-11-13", to: "2026-11-19", today: "2026-11-15", plays: 1 });
  });

  test("usual is the mean of the same stretch, to the same hour, of the four weeks the history covers", () => {
    const db = testDb();
    seed(db, [SONG], [
      full("2026-10-16T09:00:00Z"),
      full("2026-11-08T07:00:00Z"),
      full("2026-11-08T17:00:00Z"),
      full("2026-11-01T07:00:00Z"),
      full("2026-11-14T07:00:00Z"),
    ]);
    const week = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });
    expect(week.plays).toBe(1);
    expect(week.usual).toEqual({ hours: h(150_000), plays: 1, listens: 1, weeks: 4 });
  });

  test("counts only earlier weeks the history covers whole", () => {
    const db = testDb();
    seed(db, [SONG], [full("2026-10-31T09:00:00Z"), full("2026-11-06T09:00:00Z"), full("2026-11-14T09:00:00Z")]);
    expect(weekSoFar(db, { now: NOW, recapWeekday: FRIDAY }).usual).toMatchObject({ weeks: 1, plays: 1 });
  });

  test("has no usual when the history starts this week", () => {
    const db = testDb();
    seed(db, [SONG], [full("2026-11-13T09:00:00Z"), full("2026-11-14T09:00:00Z")]);
    const week = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });
    expect(week.plays).toBe(2);
    expect(week.usual).toBeNull();
  });

  test("a week with no listening yet is zeros, with the usual still there", () => {
    const db = testDb();
    seed(db, [SONG], [full("2026-10-01T09:00:00Z"), full("2026-11-07T09:00:00Z")]);
    const week = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });
    expect(week).toMatchObject({ hours: 0, plays: 0, listens: 0, topArtist: null, topTrack: null });
    expect(week.usual).toMatchObject({ weeks: 4, plays: 0 });
    expect(week.days).toHaveLength(30);
    expect(week.days.at(-1)).toEqual({ day: "2026-11-15", hours: 0 });
    expect(week.days.find((d) => d.day === "2026-11-07")?.hours).toBe(h(200_000));
  });

  test("with no plays at all there is nothing to compare", () => {
    const week = weekSoFar(testDb(), { now: NOW, recapWeekday: FRIDAY });
    expect(week).toMatchObject({ plays: 0, usual: null });
  });
});
