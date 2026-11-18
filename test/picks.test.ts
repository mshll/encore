import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client";
import { picks } from "../src/db/schema";
import { blockedSets, listBlocks } from "../src/library/blocks";
import { CandidateVerifier } from "../src/library/candidates";
import { NO_CONSTRAINTS } from "../src/library/constraints";
import { isHit, pickStats, refreshPickLibraryState, refreshPickOutcomes } from "../src/picks/outcomes";
import { generatePicks, PicksExistError, validatePicks, weekOf } from "../src/picks/service";
import { setPickState } from "../src/picks/state";
import { songKey } from "../src/plays/song";
import { play, seed, track, TZ, uri } from "./helpers";
import { featureCtx, message, scripted, seedLibrary, toolCall, toolResults, toolUse, webSearch, type FakeSpotifyTrack } from "./llmFakes";

const CATALOG: FakeSpotifyTrack[] = [
  { id: "a1", name: "Alpha", artists: ["Artist A"], album: "One" },
  { id: "c1", name: "Gamma", artists: ["Artist A"], album: "One" },
  { id: "b1", name: "Beta", artists: ["Artist B"], album: "Two" },
  { id: "w1", name: "Woods", artists: ["Mac Miller"], album: "Circles" },
];

const DAY = 86_400_000;
const ALPHA_SRC = "https://www.whosampled.test/Artist-A/Alpha/";
const BETA_SRC = "https://example.test/news/1234";
const OTHER_SRC = "https://example.test/lists/long-drive";

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
          ...webSearch("alpha samples", [
            { url: ALPHA_SRC, title: "Artist A - Alpha | sample credits" },
            { url: BETA_SRC, title: "Beta by Artist B, produced by the Woods producer" },
            { url: OTHER_SRC, title: "Ten albums for a long drive" },
          ]),
          toolUse("verify_new_song", { title: "Alpha", artist: "Artist A" }),
          toolUse("verify_new_song", { title: "Gamma", artist: "Artist A" }),
          toolUse("verify_new_song", { title: "Beta", artist: "Artist B" }),
          toolUse("verify_new_song", { title: "Woods", artist: "Mac Miller" }),
        ],
        "tool_calls",
      ),
      toolCall("submit_picks", {
        picks: [
          { uri: uri("a1"), reason: "a", distance: "near", sourceUrl: ALPHA_SRC },
          { uri: uri("c1"), reason: "c", distance: "near", sourceUrl: ALPHA_SRC },
          { uri: uri("w1"), reason: "w", distance: "far", sourceUrl: ALPHA_SRC },
        ],
      }),
      toolCall("submit_picks", {
        picks: [
          { uri: uri("a1"), reason: "Shares the producer of Woods.", distance: "near", sourceUrl: "https://made.up/alpha" },
          { uri: uri("b1"), reason: "Far: a genre you have 0 plays in.", distance: "far", sourceUrl: OTHER_SRC },
        ],
      }),
      toolCall("submit_picks", {
        picks: [
          { uri: uri("a1"), reason: "Shares the producer of Woods.", distance: "near", sourceUrl: ALPHA_SRC },
          { uri: uri("b1"), reason: "Far: a genre you have 0 plays in.", distance: "far", sourceUrl: BETA_SRC },
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
    expect(toolResults(fake.requests[3]!)[0]!.value.errors).toEqual([
      "Pick 1: Alpha is unsupported: its sourceUrl is not one of the pages your web searches returned in this run. Cite a search result that confirms the reason, or replace the pick.",
      "Pick 2: Beta is unsupported: its source page does not name the song or the artist. Cite a search result that confirms the reason, or replace the pick.",
    ]);
    expect(result.week).toBe("2026-01-26");
    expect(result.picks[1]).toMatchObject({ source: { url: BETA_SRC, title: "Beta by Artist B, produced by the Woods producer" }, albumArtUrl: "https://img.test/b1.jpg" });
    expect(result.picks.map((p) => [p.name, p.distance, p.state])).toEqual([
      ["Alpha", "near", "new"],
      ["Beta", "far", "new"],
    ]);
    const req = fake.requests[0]!;
    expect(req.effort).toBe("high");
    expect(req.webSearch).toEqual({ maxUses: 15 });
    expect(JSON.stringify(req.messages[0])).toContain("1 near the owner's taste and 1 further out");
    expect(spotifyCalls.every((c) => c.method === "GET")).toBe(true);

    await expect(generatePicks(ctx)).rejects.toBeInstanceOf(PicksExistError);
  });

  test("without a provider web search, picks need no source, carry none, and the prompt does not promise one", async () => {
    const fake = scripted(
      message([toolUse("verify_new_song", { title: "Alpha", artist: "Artist A" }), toolUse("verify_new_song", { title: "Beta", artist: "Artist B" })]),
      toolCall("submit_picks", {
        picks: [
          { uri: uri("a1"), reason: "Shares the producer of Woods.", distance: "near" },
          { uri: uri("b1"), reason: "Far: a genre you have 0 plays in.", distance: "far" },
        ],
      }),
    );
    const { ctx, db } = featureCtx(fake.transport, CATALOG, {
      PICKS_PER_WEEK: "2",
      PICKS_FAR_OUT: "1",
      AI_PROVIDER: "openai-compatible",
      AI_BASE_URL: "http://localhost:11434/v1",
      AI_MODEL: "llama4",
    });
    seedLibrary(db);

    const result = await generatePicks(ctx);

    const req = fake.requests[0]!;
    const submit = req.tools.find((t) => t.name === "submit_picks")!;
    expect({
      webSearch: req.webSearch,
      promptMentionsSearch: req.system[0]!.includes("web_search"),
      schema: JSON.stringify(submit.inputSchema).includes("sourceUrl"),
      sources: result.picks.map((p) => p.source),
    }).toEqual({ webSearch: null, promptMentionsSearch: false, schema: false, sources: [null, null] });
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
      v.verified.set(uri(s.id), { uri: uri(s.id), songKey: songKey(s.name, s.artist), name: s.name, artists: [s.artist], album: "x", albumArtUrl: null, releaseDate: null, durationMs: 1, heard: false, plays: 0 });
    return v;
  }
  const one = (id: string) => ({ picks: [{ uri: uri(id), reason: "r", distance: "near" as const, sourceUrl: "https://src.test/any-artist" }] });
  const sources = new Map([["https://src.test/any-artist", "Old X Later Y Recent Z Other Q"]]);
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
    const check = (id: string) => validatePicks(db, blockedSets(db), v, one(id), expected, "2026-02-23", now, sources, NO_CONSTRAINTS).errors;
    expect(check("o")[0]).toContain("already picked");
    expect(check("l")).toEqual([]);
    expect(check("r")[0]).toContain("already picked");
  });

  test("blocked songs and artists are rejected", () => {
    const { db } = featureCtx(null);
    const never = insertPick(db, { name: "Bad", artist: "Q" });
    setPickState(db, never.id, "never", now);
    const v = verifier(db, [{ name: "Other", artist: "Q", id: "q2" }]);
    expect(validatePicks(db, blockedSets(db), v, one("q2"), expected, "w", now, sources, NO_CONSTRAINTS).errors).toEqual([]);
    const second = insertPick(db, { name: "Worse", artist: "Q" });
    setPickState(db, second.id, "never", now);
    expect(validatePicks(db, blockedSets(db), v, one("q2"), expected, "w", now, sources, NO_CONSTRAINTS).errors).toEqual(["Pick 1: Other is blocked."]);
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

describe("concurrent generation", () => {
  test("a second run for the same week is refused at once and makes no model call", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const { ctx } = featureCtx(async () => {
      calls++;
      await held;
      return message([toolUse("noop", {})], "end");
    });
    const first = generatePicks(ctx).catch((e) => e);
    await expect(generatePicks(ctx)).rejects.toBeInstanceOf(PicksExistError);
    expect(calls).toBe(1);
    release();
    await first;
    const after = calls;
    await generatePicks(ctx).catch(() => {});
    expect(calls).toBeGreaterThan(after);
  });

  test("two rows cannot share a week and position", () => {
    const { db } = featureCtx(null);
    const row = { week: "2026-02-02", position: 1, uri: "spotify:track:x", songKey: "x|y", name: "X", artist: "Y", reason: "r", distance: "near" as const, stateAt: 0, createdAt: 0 };
    db.insert(picks).values(row).run();
    expect(() => db.insert(picks).values(row).run()).toThrow();
  });
});
