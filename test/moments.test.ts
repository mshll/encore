import { describe, expect, test } from "bun:test";
import { weekMoments } from "../src/analytics/moments";
import { play, seed, testDb, track, uri } from "./helpers";

const HOUR = 3_600_000;
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

const daily = (from: number, to: number, month = "2026-01") =>
  Array.from({ length: to - from + 1 }, (_, i) => at(`${month}-${String(from + i).padStart(2, "0")}T10:00:00Z`, A));

describe("week moments", () => {
  test("an empty history has none", () => {
    expect(weekMoments(testDb(), { from: "2026-01-02", today: "2026-01-05" })).toEqual([]);
  });

  test("a record, a milestone and new artists come first, in that order, and the list stops at three", () => {
    const tenOfB = Array.from({ length: 10 }, (_, i) => at(`2026-01-07T${String(8 + i).padStart(2, "0")}:00:00Z`, B));
    const d = db(...daily(1, 30, "2025-12"), ...daily(1, 7), ...tenOfB);

    const moments = weekMoments(d, { from: "2026-01-05", today: "2026-01-07" });

    expect(moments.map((m) => m.kind)).toEqual(["record", "milestone", "newArtists"]);
  });

  test("new artists count those whose first play is this week, and link to Discovery", () => {
    const d = db(at("2025-11-01T10:00:00Z", A), at("2026-01-06T10:00:00Z", A), at("2026-01-06T11:00:00Z", B));

    const moment = weekMoments(d, { from: "2026-01-05", today: "2026-01-07" }).find((m) => m.kind === "newArtists");

    expect(moment).toMatchObject({ target: "discovery", count: 1, artists: [{ artist: "Artist Y" }] });
  });

  test("a young history gives no record and no new artists, but still a run of days", () => {
    const d = db(...daily(1, 7));

    const moments = weekMoments(d, { from: "2026-01-02", today: "2026-01-07" });

    expect(moments.map((m) => m.kind)).toEqual(["streak"]);
  });

  test("a run under seven days is no moment", () => {
    const d = db(...daily(2, 7));

    expect(weekMoments(d, { from: "2026-01-02", today: "2026-01-07" })).toEqual([]);
  });

  test("an artist back this week after six active months away is a comeback", () => {
    const away = ["02", "03", "04", "05", "06", "07"].map((m) => at(`2026-${m}-10T10:00:00Z`, A, HOUR));
    const d = db(at("2026-01-10T10:00:00Z", B, 4 * HOUR), ...away, at("2026-08-07T10:00:00Z", B, HOUR));

    const moment = weekMoments(d, { from: "2026-08-07", today: "2026-08-09" }).find((m) => m.kind === "comeback");

    expect(moment).toMatchObject({ target: "discovery", comeback: { artist: "Artist Y", returned: "2026-08-07" } });
  });
});
