import { describe, expect, test } from "bun:test";
import { highlightText, milestoneText, ordinal } from "../web/src/lib/insights";

const SONG = { songKey: "loser|tame impala", uri: "spotify:track:7bxaFZ1O3cHkgLKMsdC3xR", name: "Loser", artist: "Tame Impala", albumArtUrl: null };

describe("insight copy", () => {
  test("ordinals, teens included", () => {
    expect([1, 2, 3, 10, 11, 12, 13, 21, 25, 1000].map(ordinal)).toEqual(["1st", "2nd", "3rd", "10th", "11th", "12th", "13th", "21st", "25th", "1,000th"]);
  });

  test("a milestone row puts the threshold in the figure", () => {
    expect(milestoneText({ kind: "song", threshold: 25, day: "2026-11-13", song: SONG })).toEqual({ title: "Loser", figure: "25th", detail: "Tame Impala · 13 Nov 2026" });
    expect(milestoneText({ kind: "total", threshold: 1000, day: "2025-09-14" })).toEqual({ title: "All music", figure: "1,000 h", detail: "14 Sep 2025" });
  });

  test("each highlight reads as one sentence", () => {
    expect(highlightText({ kind: "streak", days: 17, from: "2026-10-29", to: "2026-11-14" })).toBe("17 days in a row with music, since 29 Oct 2026");
    expect(highlightText({ kind: "record", record: "session", day: "2026-11-15", minutes: 295, hours: 4.86 })).toBe("Your longest session yet: 4 h 55 min on 15 Nov");
    expect(highlightText({ kind: "milestone", milestone: { kind: "song", threshold: 25, day: "2026-11-13", song: SONG } })).toBe("Your 25th listen of Loser by Tame Impala");
  });
});
