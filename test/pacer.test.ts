import { describe, expect, test } from "bun:test";
import { currentPriority, inBackground, SpotifyPacer } from "../src/spotify/pacer";
import { runJob } from "../src/jobs/scheduler";
import { connectSpotify, jsonResponse, routeFetch, testConfig, testDb } from "./helpers";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: async (ms: number) => void (sleeps.push(ms), (t += ms)), sleeps };
}

describe("Spotify pacer", () => {
  test("runs one call at a time, starts spaced by the minimum interval", async () => {
    const clock = fakeClock();
    const pacer = new SpotifyPacer(2000, clock.now, clock.sleep);
    const starts: number[] = [];
    let running = 0;
    let overlap = false;
    const call = () =>
      pacer.run(async () => {
        running++;
        if (running > 1) overlap = true;
        starts.push(clock.now());
        await Promise.resolve();
        running--;
      });
    await Promise.all([call(), call(), call()]);
    expect(starts).toEqual([0, 2000, 4000]);
    expect(overlap).toBe(false);
    expect(pacer.calls).toBe(3);
  });

  test("an interactive call waiting with background calls goes first", async () => {
    const clock = fakeClock();
    const pacer = new SpotifyPacer(2000, clock.now, clock.sleep);
    const order: string[] = [];
    const job = (name: string) => inBackground(() => pacer.run(async () => void order.push(name)));
    const all = [job("bg1"), job("bg2"), job("bg3"), pacer.run(async () => void order.push("ui"))];
    await Promise.all(all);
    expect(order).toEqual(["bg1", "ui", "bg2", "bg3"]);
  });

  test("errors reach the caller and do not stop the queue", async () => {
    const pacer = new SpotifyPacer(0);
    const failed = pacer.run(async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    expect(await pacer.run(async () => 7)).toBe(7);
  });

  test("calls made by scheduled jobs are background; the client paces every Web API call", async () => {
    const db = testDb();
    const config = testConfig({ SPOTIFY_MIN_INTERVAL_MS: "0" });
    connectSpotify(db);
    const { fn } = routeFetch(() => jsonResponse({ id: "me", display_name: null }));
    const clock = fakeClock();
    const pacer = new SpotifyPacer(1000, clock.now, clock.sleep);
    const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, fn), config, fn, Date.now, pacer);
    const seen: string[] = [];
    const original = pacer.run.bind(pacer);
    pacer.run = ((f: () => Promise<unknown>, as?: "interactive" | "background") => {
      seen.push(as ?? currentPriority());
      return original(f, as);
    }) as typeof pacer.run;
    await spotify.me();
    await runJob(db, { name: "x", intervalMs: 1, run: async () => void (await spotify.me()) });
    expect(seen).toEqual(["interactive", "background"]);
    expect(pacer.calls).toBe(2);
    expect(clock.sleeps).toEqual([1000]);
  });
});
