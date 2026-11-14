import { describe, expect, test } from "bun:test";
import { deviceFromPlatform } from "../src/plays/device";
import { localTime } from "../src/plays/localTime";
import { normalizeTitle, songKey } from "../src/plays/song";

describe("song key", () => {
  test("merges remasters and featured-artist variants", () => {
    expect(songKey("Bohemian Rhapsody - Remastered 2011", "Queen")).toBe(songKey("Bohemian Rhapsody", "Queen"));
    expect(songKey("Song (feat. Someone)", "Artist")).toBe(songKey("Song", "Artist"));
    expect(songKey("Song [with Other]", "Artist")).toBe(songKey("Song", "Artist"));
    expect(songKey("Don’t Stop (Remastered)", "Artist")).toBe(songKey("Don't Stop", "artist"));
  });

  test("keeps live and differently named versions apart", () => {
    expect(normalizeTitle("Nights - Live")).not.toBe(normalizeTitle("Nights"));
    expect(songKey("Song", "Artist A")).not.toBe(songKey("Song", "Artist B"));
  });
});

describe("device mapping", () => {
  test.each([
    ["ios", "ios"],
    ["iOS 15.0 (iPhone12,5)", "ios"],
    ["Partner SCEI sony_tv;ps5;9b18;;tpapi", "console"],
    ["osx", "mac"],
    ["windows", "windows"],
    ["Android OS 10 API 29 (Google, Pixel)", "android"],
    ["unknown", "unknown"],
    [null, "unknown"],
    ["toaster", "other"],
  ] as const)("%p -> %p", (platform, device) => {
    expect(deviceFromPlatform(platform)).toBe(device);
  });
});

describe("local time", () => {
  test("buckets in Kuwait time across midnight", () => {
    expect(localTime(Date.parse("2026-01-04T22:30:00Z"), "Asia/Kuwait")).toEqual({ day: "2026-01-05", hour: 1, weekday: 1 });
    expect(localTime(Date.parse("2026-01-11T20:59:00Z"), "Asia/Kuwait")).toEqual({ day: "2026-01-11", hour: 23, weekday: 7 });
  });
});
