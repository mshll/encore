import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { musicWhere } from "../src/analytics/common";
import { skipProfile } from "../src/analytics/skips";
import { localNow } from "../src/llm/context";
import { play, seed, testApp, testDb, track, TZ, uri } from "./helpers";

const SUNDAY_NOON = "2026-11-15T09:00:00Z";

describe("weekend days", () => {
  test("decide which plays count as weekend in skip contexts", () => {
    const db = testDb();
    seed(db, [track("a", "A", "Artist", "Album")], [play(SUNDAY_NOON, uri("a"), 200_000, { skipped: false })]);

    const dayTypes = [[5, 6], [6, 7]].map((days) => skipProfile(db, musicWhere({}), days).dayType.map((d) => d.value));

    expect(dayTypes).toEqual([["weekday"], ["weekend"]]);
  });

  test("are named in the local time Claude is given", () => {
    const text = localNow({ timezone: TZ, weekendDays: [6, 7] }, Date.parse(SUNDAY_NOON));

    expect(text).toBe("Sunday 2026-11-15 12:00 (afternoon, weekend; weekend days: Saturday and Sunday)");
  });

  test("are reported by /api/status and follow a settings change without a restart", async () => {
    const { app, db, settings } = testApp();
    const cookie = `encore_session=${createSession(db)}`;
    const read = async () => ((await (await app.request("/api/status", { headers: { cookie } })).json()) as { weekendDays: number[] }).weekendDays;

    const before = await read();
    settings.update({ weekendDays: [6, 7] });

    expect([before, await read()]).toEqual([[5, 6], [6, 7]]);
  });
});
