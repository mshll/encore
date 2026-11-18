import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Db } from "../src/db/client";
import { picks, releases, releaseTracks, type LivingKind } from "../src/db/schema";
import { livingCoverKey } from "../src/living/cover";
import { buildRule } from "../src/living/engine";
import { replaceMerge } from "../src/living/merge";
import { LIVING } from "../src/living/kinds";
import { songKey } from "../src/plays/song";
import { play, seed, testDb, track, TZ, uri } from "./helpers";

const DAY = 86_400_000;
const NOWS = {
  "mid-November": Date.parse("2026-11-14T09:00:00Z"),
  "first local hour of a year": Date.parse("2026-12-31T21:30:00Z"),
  "last local hour of a month": Date.parse("2026-11-30T20:30:00Z"),
};

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** Three years of plays over 40 songs (two of them in two versions), with listens, skips and interruptions, plus picks and releases. */
function fixture(): Db {
  const db = testDb();
  const rand = random(7);
  const end = NOWS["first local hour of a year"];
  const songs = Array.from({ length: 40 }, (_, i) => track(`s${i}`, `Song ${i % 37}`, `Artist ${i % 6}`, `Album ${i % 9}`));
  const plays = songs.flatMap((s, i) =>
    Array.from({ length: 2 + Math.floor(rand() * 25) }, () => {
      const ts = new Date(end - Math.floor(rand() * 3 * 365 * DAY)).toISOString();
      const roll = rand();
      if (roll < 0.15) return play(ts, s.uri, 4_000 + i, { skipped: true });
      if (roll < 0.2) return play(ts, s.uri, 90_000, { reasonEnd: "endplay" });
      return play(ts, s.uri, 150_000 + Math.floor(rand() * 5) * 10_000);
    }),
  );
  const recent = [NOWS["mid-November"], end].flatMap((at) =>
    songs.slice(0, 10).flatMap((s, i) => Array.from({ length: 1 + (i % 4) }, () => play(new Date(at - Math.floor(rand() * 35 * DAY)).toISOString(), s.uri, 200_000))),
  );
  seed(db, songs, [...plays, ...recent]);

  let position = 0;
  for (const [week, ids] of [["2026-11-02", ["p1", "p2"]], ["2026-11-09", ["p3", "s4", "p5", "p6"]]] as const) {
    for (const id of ids) {
      db.insert(picks)
        .values({ week, position: ++position, uri: uri(id), songKey: songKey(id, "P"), name: id, artist: "P", reason: "r", distance: "near", state: id === "p5" ? "never" : "new", stateAt: 0, createdAt: 0 })
        .run();
    }
  }
  const release = (id: string, name: string, releaseDate: string, albumType: string, isNew: boolean) => {
    db.insert(releases).values({ id, uri: `spotify:album:${id}`, artistId: "x", artistName: "X", name, albumType, releaseDate, firstSeenAt: 0, isNew }).run();
    for (const position of [0, 1, 2]) db.insert(releaseTracks).values({ releaseId: id, position, uri: uri(`${id}${position}`), songKey: songKey(`${id} ${position}`, "X"), name: `${id} ${position}`, artist: "X" }).run();
  };
  release("r1", "Fresh", "2026-11-10", "single", true);
  release("r2", "Older", "2026-09-01", "album", true);
  release("r3", "Fresh (Deluxe Edition)", "2026-11-11", "album", true);
  release("r4", "Ancient", "2025-01-01", "album", true);
  release("r5", "Seen", "2026-11-12", "single", false);
  return db;
}

/** The kinds that had hand-written builders, recorded in the snapshot from those builders. */
const HAND_WRITTEN: LivingKind[] = ["picks", "forgotten", "most-played", "new-releases", "this-month", "this-year"];

const db = fixture();

describe("built-in rules build what the hand-written builders built", () => {
  for (const [moment, now] of Object.entries(NOWS)) {
    for (const kind of HAND_WRITTEN) {
      test(`${kind} at the ${moment}`, () => {
        const ctx = { now, timezone: TZ };
        const spec = LIVING[kind];

        const built = replaceMerge(buildRule(db, spec.rule, ctx), 200);

        expect(built).toMatchSnapshot();
      });
    }
  }

  test("the fixture gives every built-in songs to compare", () => {
    const ctx = { now: NOWS["mid-November"], timezone: TZ };

    const sizes = HAND_WRITTEN.map((kind) => buildRule(db, LIVING[kind].rule, ctx).length);

    expect(sizes.every((n) => n > 0)).toBe(true);
  });
});

test("built-in cover keys are the ones already uploaded, so no cover is drawn or uploaded again", () => {
  const keys = HAND_WRITTEN.map((kind) => livingCoverKey(LIVING[kind]));

  expect(keys).toEqual(["fbf7ef747f464855", "562c55763218a67d", "40de48e57c3657e6", "2ca0fdea2adae85a", "7fef2e5043bf55ca", "a112e81b2d950823"]);
});

test("a rule playlist's cover key changes only when its name is too long for the cover", () => {
  const cover = LIVING[HAND_WRITTEN[0]!].cover;
  const unclamped = (name: string) => createHash("sha256").update(JSON.stringify([1, name, cover.style, cover.colours])).digest("hex").slice(0, 16);
  const short = "Late drive";
  const long = "Songs I kept coming back to on the long drives home from the coast every summer";

  const keys = [livingCoverKey({ id: "u1", name: short, cover }), livingCoverKey({ id: "u2", name: long, cover })];

  expect([keys[0] === unclamped(short), keys[1] === unclamped(long)]).toEqual([true, false]);
});
