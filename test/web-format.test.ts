import { describe, expect, test } from "bun:test";
import { fmtHours, hoursParts } from "../web/src/lib/format";

const seconds = (s: number) => s / 3600;

describe("durations", () => {
  test("a few seconds read as under a minute, not zero", () => {
    const labels = [fmtHours(seconds(20)), fmtHours(seconds(35))];

    expect(labels).toEqual(["<1 min", "<1 min"]);
  });

  test("nothing at all reads as zero", () => {
    expect(fmtHours(0)).toBe("0 min");
  });

  test("a minute or more rounds to whole minutes, then hours", () => {
    const labels = [fmtHours(seconds(60)), fmtHours(seconds(90)), fmtHours(seconds(59 * 60 + 50)), fmtHours(2.25)];

    expect(labels).toEqual(["1 min", "2 min", "1 h", "2.3 h"]);
  });

  test("the split figure says under a minute for a few seconds", () => {
    const parts = [hoursParts(seconds(20)), hoursParts(0), hoursParts(seconds(60)), hoursParts(3)];

    expect(parts).toEqual([
      { value: "<1", unit: "minute" },
      { value: "0", unit: "minutes" },
      { value: "1", unit: "minute" },
      { value: "3", unit: "hours" },
    ]);
  });
});
