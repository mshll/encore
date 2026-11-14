import { describe, expect, test } from "bun:test";
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
