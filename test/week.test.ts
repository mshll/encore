import { describe, expect, test } from "bun:test";
import { hours as h } from "../src/analytics/common";
import { weekSoFar } from "../src/analytics/week";
import { play, seed, testDb, track, uri } from "./helpers";

const B = uri("b");
const OTHER = track("b", "Song B", "Artist Y", "Album", { durationMs: 200_000 });

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
    expect(week.days.map((d) => d.hours)).toEqual([0, 0, 0, null, null, null, null]);
  });

  test("with no plays at all there is nothing to compare", () => {
    const week = weekSoFar(testDb(), { now: NOW, recapWeekday: FRIDAY });
    expect(week).toMatchObject({ plays: 0, usual: null });
  });
});

describe("week days", () => {
  test("one per day of the week, Friday to Thursday, with no hours for the days still to come", () => {
    const db = testDb();
    seed(db, [SONG], [full("2026-11-14T09:00:00Z")]);

    const { days } = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });

    expect(days.map((d) => [d.day, d.hours])).toEqual([
      ["2026-11-13", 0],
      ["2026-11-14", h(200_000)],
      ["2026-11-15", 0],
      ["2026-11-16", null],
      ["2026-11-17", null],
      ["2026-11-18", null],
      ["2026-11-19", null],
    ]);
  });

  test("a play after 21:00 UTC lands on the next local day", () => {
    const db = testDb();
    seed(db, [SONG], [full("2026-11-13T21:30:00Z")]);

    const { days } = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });

    expect(days.find((d) => d.hours)?.day).toBe("2026-11-14");
  });

  test("each day's usual is the mean of the whole same weekday in the weeks the history covers, late hours included", () => {
    const db = testDb();
    seed(db, [SONG], [full("2026-10-09T09:00:00Z"), full("2026-11-06T20:00:00Z"), full("2026-11-06T20:30:00Z"), full("2026-10-30T09:00:00Z"), full("2026-11-12T09:00:00Z")]);

    const { days } = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });

    expect(days[0]!.usual).toBe(h(600_000) / 4);
    expect(days[6]!.usual).toBe(h(200_000) / 4);
  });

  test("days have no usual in the first week of history", () => {
    const db = testDb();
    seed(db, [SONG], [full("2026-11-13T09:00:00Z")]);

    const { days } = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });

    expect(days.every((d) => d.usual === null)).toBe(true);
  });
});

describe("week repeats", () => {
  test("a listen is a repeat when the same song had a listen earlier this week", () => {
    const db = testDb();
    seed(db, [SONG, OTHER], [full("2026-11-13T09:00:00Z"), full("2026-11-13T10:00:00Z"), full("2026-11-14T09:00:00Z"), play("2026-11-14T10:00:00Z", B, 200_000)]);

    const { repeats } = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });

    expect(repeats).toEqual({ listens: 4, repeats: 2, share: 0.5 });
  });

  test("listens before the week and plays under 30 s do not make a repeat", () => {
    const db = testDb();
    seed(db, [SONG], [full("2026-11-12T09:00:00Z"), play("2026-11-13T09:00:00Z", A, 10_000), full("2026-11-14T09:00:00Z")]);

    const { repeats } = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });

    expect(repeats).toEqual({ listens: 1, repeats: 0, share: 0 });
  });

  test("an empty week has no share", () => {
    const { repeats } = weekSoFar(testDb(), { now: NOW, recapWeekday: FRIDAY });

    expect(repeats).toEqual({ listens: 0, repeats: 0, share: null });
  });
});

describe("week best", () => {
  test("a tie in hours goes to the artist and the song key first in alphabetical order", () => {
    const db = testDb();
    seed(db, [OTHER, SONG], [play("2026-11-14T09:00:00Z", B, 200_000), full("2026-11-14T10:00:00Z")]);

    const week = weekSoFar(db, { now: NOW, recapWeekday: FRIDAY });

    expect([week.topArtist?.artist, week.topTrack?.name]).toEqual(["Artist X", "Song A"]);
  });
});
