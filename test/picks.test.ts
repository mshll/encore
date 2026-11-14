import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client";
import { picks } from "../src/db/schema";
import { blockedSets, listBlocks } from "../src/library/blocks";
import { CandidateVerifier } from "../src/library/candidates";
import { isHit, pickStats, refreshPickLibraryState, refreshPickOutcomes } from "../src/picks/outcomes";
import { generatePicks, PicksExistError, syncPicksPlaylist, validatePicks, weekOf } from "../src/picks/service";
import { setPickState } from "../src/picks/state";
import { songKey } from "../src/plays/song";
import { play, seed, track, TZ, uri } from "./helpers";
import { featureCtx, message, scripted, seedLibrary, toolCall, toolResults, toolUse, type FakeSpotifyTrack } from "./llmFakes";

const CATALOG: FakeSpotifyTrack[] = [
  { id: "a1", name: "Alpha", artists: ["Artist A"], album: "One" },
  { id: "c1", name: "Gamma", artists: ["Artist A"], album: "One" },
  { id: "b1", name: "Beta", artists: ["Artist B"], album: "Two" },
  { id: "w1", name: "Woods", artists: ["Mac Miller"], album: "Circles" },
];

const DAY = 86_400_000;

let pickIds = 0;
function insertPick(db: Db, p: { name: string; artist: string; state?: "new" | "saved" | "not_now" | "never"; createdAt?: number; week?: string; distance?: "near" | "far" }) {
  const id = `p${++pickIds}`;
  return db
    .insert(picks)
    .values({
      week: p.week ?? "2026-01-05",
      position: pickIds,
      uri: uri(id),
      songKey: songKey(p.name, p.artist),
      name: p.name,
      artist: p.artist,
      album: null,
      releaseDate: null,
      reason: "r",
      distance: p.distance ?? "near",
      state: p.state ?? "new",
      stateAt: 0,
      createdAt: p.createdAt ?? Date.parse("2026-01-05T10:00:00Z"),
    })
    .returning()
    .get();
}

describe("generate picks", () => {
  test("verifies, rejects invalid submissions, stores exactly the configured mix", async () => {
    const fake = scripted(
      message(
        [
          toolUse("verify_new_song", { title: "Alpha", artist: "Artist A" }),
          toolUse("verify_new_song", { title: "Gamma", artist: "Artist A" }),
          toolUse("verify_new_song", { title: "Beta", artist: "Artist B" }),
          toolUse("verify_new_song", { title: "Woods", artist: "Mac Miller" }),
        ],
        "tool_use",
      ),
      toolCall("submit_picks", {
        picks: [
          { uri: uri("a1"), reason: "a", distance: "near" },
          { uri: uri("c1"), reason: "c", distance: "near" },
          { uri: uri("w1"), reason: "w", distance: "far" },
        ],
      }),
      toolCall("submit_picks", {
        picks: [
          { uri: uri("a1"), reason: "Shares the producer of Woods.", distance: "near" },
          { uri: uri("b1"), reason: "Far: a genre you have 0 plays in.", distance: "far" },
        ],
      }),
    );
    const { ctx, db, spotifyCalls } = featureCtx(fake.transport, CATALOG, { PICKS_PER_WEEK: "2", PICKS_FAR_OUT: "1" });
    seedLibrary(db);
    const result = await generatePicks(ctx);

    const errors = toolResults(fake.requests[2]!)[0]!.value.errors as string[];
    expect(errors).toEqual([
      "Submit exactly 2 picks; got 3.",
      "Pick 2: only one pick per artist (Artist A).",
      "Pick 3: the owner has already played Woods.",
    ]);
    expect(result.week).toBe("2026-01-26");
    expect(result.picks.map((p) => [p.name, p.distance, p.state])).toEqual([
      ["Alpha", "near", "new"],
      ["Beta", "far", "new"],
    ]);
    const req = fake.requests[0]!;
    expect(req.output_config).toEqual({ effort: "high" });
    expect(req.tools).toContainEqual({ type: "web_search_20260209", name: "web_search", max_uses: 15 });
    expect(JSON.stringify(req.messages[0])).toContain("1 near the owner's taste and 1 further out");
    expect(spotifyCalls.every((c) => c.method === "GET")).toBe(true);

    await expect(generatePicks(ctx)).rejects.toBeInstanceOf(PicksExistError);
  });

  test("the week is the local Monday", () => {
    expect(weekOf(Date.parse("2026-02-01T20:59:00Z"), TZ)).toBe("2026-01-26");
    expect(weekOf(Date.parse("2026-02-01T21:00:00Z"), TZ)).toBe("2026-02-02");
  });
});

describe("validatePicks", () => {
  const now = Date.parse("2026-03-01T10:00:00Z");
  function verifier(db: Db, songs: { name: string; artist: string; id: string }[]) {
    const { ctx } = featureCtx(null);
    const v = new CandidateVerifier(db, ctx.spotify, blockedSets(db), 0);
    for (const s of songs)
      v.verified.set(uri(s.id), { uri: uri(s.id), songKey: songKey(s.name, s.artist), name: s.name, artists: [s.artist], album: "x", releaseDate: null, durationMs: 1, heard: false, plays: 0 });
    return v;
  }
  const one = (id: string) => ({ picks: [{ uri: uri(id), reason: "r", distance: "near" as const }] });
  const expected = { count: 1, far: 0 };

  test("a song picked before cannot return, except not_now after 28 days", () => {
    const { db } = featureCtx(null);
    insertPick(db, { name: "Old", artist: "X", state: "new", createdAt: now - 60 * DAY });
    insertPick(db, { name: "Later", artist: "Y", state: "not_now", createdAt: now - 60 * DAY });
    insertPick(db, { name: "Recent", artist: "Z", state: "not_now", createdAt: now - 7 * DAY });
    const v = verifier(db, [
      { name: "Old", artist: "X", id: "o" },
      { name: "Later", artist: "Y", id: "l" },
      { name: "Recent", artist: "Z", id: "r" },
    ]);
    const check = (id: string) => validatePicks(db, blockedSets(db), v, one(id), expected, "2026-02-23", now).errors;
    expect(check("o")[0]).toContain("already picked");
    expect(check("l")).toEqual([]);
    expect(check("r")[0]).toContain("already picked");
  });

  test("blocked songs and artists are rejected", () => {
    const { db } = featureCtx(null);
    const never = insertPick(db, { name: "Bad", artist: "Q" });
    setPickState(db, never.id, "never", now);
    const v = verifier(db, [{ name: "Other", artist: "Q", id: "q2" }]);
    expect(validatePicks(db, blockedSets(db), v, one("q2"), expected, "w", now).errors).toEqual([]);
    const second = insertPick(db, { name: "Worse", artist: "Q" });
    setPickState(db, second.id, "never", now);
    expect(validatePicks(db, blockedSets(db), v, one("q2"), expected, "w", now).errors).toEqual(["Pick 1: Other is blocked."]);
  });
});

describe("pick state machine", () => {
  const now = Date.parse("2026-02-01T10:00:00Z");
  const blockKeys = (db: Db) => listBlocks(db).map((b) => `${b.kind}:${b.key}`);

  test("never blocks the song; a second never for the artist blocks the artist; undoing lifts both", () => {
    const { db } = featureCtx(null);
    const a = insertPick(db, { name: "One", artist: "Band" });
    const b = insertPick(db, { name: "Two", artist: "band " });
    setPickState(db, a.id, "never", now);
    expect(blockKeys(db)).toEqual([`song:${a.songKey}`]);
    setPickState(db, b.id, "never", now);
    expect(blockKeys(db).sort()).toEqual(["artist:band", `song:${a.songKey}`, `song:${b.songKey}`].sort());
    const reverted = setPickState(db, b.id, "saved", now + 1);
    expect(reverted).toMatchObject({ state: "saved", stateAt: now + 1 });
    expect(blockKeys(db)).toEqual([`song:${a.songKey}`]);
  });

  test("not_now and saved never block", () => {
    const { db } = featureCtx(null);
    const a = insertPick(db, { name: "One", artist: "Band" });
    setPickState(db, a.id, "not_now", now);
    setPickState(db, a.id, "saved", now);
    expect(listBlocks(db)).toEqual([]);
  });
});

describe("pick outcomes", () => {
  test("a hit is finished at least once and replayed on another day, saved to the library, or marked saved", () => {
    expect(isHit({ finished: 1, playDays: 2, inLibrary: null, state: "new" })).toBe(true);
    expect(isHit({ finished: 1, playDays: 1, inLibrary: true, state: "new" })).toBe(true);
    expect(isHit({ finished: 1, playDays: 1, inLibrary: false, state: "saved" })).toBe(true);
    expect(isHit({ finished: 1, playDays: 1, inLibrary: false, state: "new" })).toBe(false);
    expect(isHit({ finished: 0, playDays: 3, inLibrary: true, state: "saved" })).toBe(false);
  });

  test("plays after the pick are counted and only settled picks enter the hit rate", () => {
    const { db } = featureCtx(null);
    const created = Date.parse("2026-01-05T10:00:00Z");
    const hit = insertPick(db, { name: "Hit", artist: "H", createdAt: created });
    insertPick(db, { name: "Miss", artist: "M", createdAt: created });
    insertPick(db, { name: "Fresh", artist: "F", createdAt: created + 5 * DAY });
    seed(
      db,
      [track("h", "Hit", "H", null, { durationMs: 200_000 })],
      [
        play("2026-01-04T10:00:00Z", uri("h"), 200_000),
        play("2026-01-06T10:00:00Z", uri("h"), 200_000),
        play("2026-01-07T10:00:00Z", uri("h"), 190_000),
        play("2026-01-07T12:00:00Z", uri("h"), 1_000, { skipped: true }),
      ],
    );
    refreshPickOutcomes(db);
    expect(db.select().from(picks).where(eq(picks.id, hit.id)).get()).toMatchObject({ plays: 3, finished: 2, playDays: 2 });
    expect(pickStats(db, created + 8 * DAY)).toEqual({ settled: 2, played: 1, hits: 1, hitRate: 0.5 });
  });

  test("library state is read with one GET for recent picks", async () => {
    const { ctx, db, spotifyCalls } = featureCtx(null);
    const now = ctx.now();
    insertPick(db, { name: "In", artist: "I", createdAt: now - DAY });
    insertPick(db, { name: "Out", artist: "O", createdAt: now - DAY });
    await refreshPickLibraryState(db, ctx.spotify, now);
    expect(spotifyCalls).toHaveLength(1);
    expect(spotifyCalls[0]!.method).toBe("GET");
    expect(spotifyCalls[0]!.path).toStartWith("/v1/me/library/contains?uris=");
    const rows = db.select({ uri: picks.uri, inLibrary: picks.inLibrary }).from(picks).all();
    expect(new URLSearchParams(spotifyCalls[0]!.path.split("?")[1]).get("uris")).toBe(rows.map((r) => r.uri).join(","));
    for (const r of rows) expect(r.inLibrary).toBe(r.uri.endsWith("1"));
  });
});

describe("picks playlist mirror", () => {
  test("creates one private playlist, then updates it in place without never picks", async () => {
    const { ctx, db, spotifyCalls } = featureCtx(null);
    const week = weekOf(ctx.now(), TZ);
    const keep = insertPick(db, { name: "Keep", artist: "K", week });
    const drop = insertPick(db, { name: "Drop", artist: "D", week });
    await syncPicksPlaylist(db, ctx.spotify, TZ, ctx.now());
    setPickState(db, drop.id, "never", ctx.now());
    await syncPicksPlaylist(db, ctx.spotify, TZ, ctx.now());
    expect(spotifyCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /v1/me/playlists",
      "PUT /v1/playlists/pl1/items",
      "PUT /v1/playlists/pl1",
      "PUT /v1/playlists/pl1/items",
    ]);
    expect(spotifyCalls[0]!.body).toMatchObject({ public: false });
    expect(spotifyCalls[1]!.body).toEqual({ uris: [keep.uri, drop.uri] });
    expect(spotifyCalls[3]!.body).toEqual({ uris: [keep.uri] });
  });
});
