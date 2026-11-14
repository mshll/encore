import { describe, expect, test } from "bun:test";
import { allowedNumbers, unsupportedNumbers } from "../src/digest/numbers";
import { plainText } from "../src/llm/plainText";

describe("plainText", () => {
  test("removes headings, emphasis, code and tables, keeps the words and numbers", () => {
    const md = [
      "## Joji in 2026",
      "",
      "",
      "You played **Joji** 41 times in March, *down* from 120 in `February`.",
      "",
      "| Month | Listens |",
      "| --- | ---: |",
      "| March | 41 |",
      "Based on: artist_history, 2026-01-01 to 2026-03-31.",
    ].join("\n");
    expect(plainText(md)).toBe(
      ["Joji in 2026", "", "You played Joji 41 times in March, down from 120 in February.", "", "Month, Listens", "March, 41", "Based on: artist_history, 2026-01-01 to 2026-03-31."].join("\n"),
    );
  });

  test("leaves plain text and arithmetic alone", () => {
    const text = "Skips rose to 0.62 at 2*3 in the morning.\nBased on: skip_split.";
    expect(plainText(text)).toBe(text);
  });
});

describe("digest number check", () => {
  const facts = {
    period: { from: "2026-01-04", to: "2026-01-10", days: 7 },
    totals: { hours: 12.4, baselineHours: 8.1, hoursChangePct: 53, listens: 1234, skipRate: 0.512 },
    peakHour: { hour: 23, hours: 1.2 },
  };
  const allowed = allowedNumbers(facts);

  test("numbers from the facts pass in their rounded, percent, date and clock forms", () => {
    expect(unsupportedNumbers("12.4 hours, up 53% from 8.1. 1,234 listens, 51% skipped (51.2%). Busiest at 11 pm, 4 to 10 January 2026, 7 days, 12 hours.", allowed)).toEqual([]);
  });

  test("numbers the model computed or invented are reported", () => {
    expect(unsupportedNumbers("Up 4.3 hours, about 3 times your usual, across 18 artists.", allowed)).toEqual(["4.3", "3", "18"]);
  });
});
