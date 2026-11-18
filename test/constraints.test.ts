import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { constrainTail, sessionConstraints } from "../src/dj/constraints";
import { addBlock } from "../src/library/blocks";
import { CandidateVerifier } from "../src/library/candidates";
import { constraintErrors, NO_CONSTRAINTS, type ConstrainedSong, type Constraints } from "../src/library/constraints";
import { Llm } from "../src/llm/client";
import { picksConstraints, validatePicks } from "../src/picks/service";
import { blockedSets } from "../src/library/blocks";
import { songKey } from "../src/plays/song";
import { createSet, getSet, refineSet, updateSetConstraints } from "../src/sets/service";
import { djSessions, setSessions } from "../src/db/schema";
import { testApp, uri } from "./helpers";
import { featureCtx, scripted, seedLibrary, SONGS, toolCall, toolResults, type FakeSpotifyTrack } from "./llmFakes";

const CATALOG: FakeSpotifyTrack[] = [
  { id: "g1", name: "Good News", artists: ["Mac Miller"], album: "Circles" },
  { id: "p1", name: "Pink Matter", artists: ["Frank Ocean", "André 3000"], album: "channel ORANGE" },
  { id: "h1", name: "Hand Me Downs", artists: ["Mac Miller", "Baro Sura"], album: "Circles" },
];

const WOODS = songKey("Woods", "Mac Miller");
const SURF = songKey("Surf", "Mac Miller");
const NIGHTS = songKey("Nights", "Frank Ocean");
const DNA = songKey("DNA.", "Kendrick Lamar");

const lib = (k: string) => ({ source: "library", songKey: k, reason: "r" });
const fresh = (id: string) => ({ source: "new", uri: uri(id), reason: "r" });
const submit = (...items: object[]) => toolCall("submit_set", { title: "Night", description: "Late.", items });

const c = (patch: Partial<Constraints>): Constraints => ({ ...NO_CONSTRAINTS, ...patch });
const song = (position: number, name: string, artists: string[], album: string | null, isNew = false): ConstrainedSong => ({
  position,
  songKey: songKey(name, artists[0]!),
  name,
  artists,
  album,
  isNew,
});

describe("constraintErrors", () => {
  const set = [song(1, "Woods", ["Mac Miller"], "Circles"), song(2, "Nights", ["Frank Ocean"], "Blonde"), song(3, "Surf", ["Mac Miller"], "Circles"), song(4, "Good News", ["Mac Miller"], "Circles", true)];

  test("a cap of 1 per artist names the artist, the positions and how many to replace", () => {
    expect(constraintErrors(set, c({ maxPerArtist: 1 }))).toEqual(["Mac Miller has 3 tracks (tracks 1, 3, 4); the owner allows at most 1 per artist. Replace 2 of them."]);
  });

  test("the artist cap counts the primary artist only", () => {
    const featured = [song(1, "Woods", ["Mac Miller"], null), song(2, "Pink Matter", ["Frank Ocean", "Mac Miller"], null)];
    expect(constraintErrors(featured, c({ maxPerArtist: 1 }))).toEqual([]);
  });

  test("the album cap counts by album name, case-insensitive, and ignores songs without one", () => {
    const songs = [...set, song(5, "DNA.", ["Kendrick Lamar"], "circles "), song(6, "X", ["Y"], null), song(7, "Z", ["Y"], null)];
    expect(constraintErrors(songs, c({ maxPerAlbum: 2 }))).toEqual(["The album Circles has 4 tracks (tracks 1, 3, 4, 5); the owner allows at most 2 per album. Replace 2 of them."]);
  });

  test("newSongs is an exact count, in both directions", () => {
    expect(constraintErrors(set, c({ newSongs: 1 }))).toEqual([]);
    expect(constraintErrors(set, c({ newSongs: 0 }))).toEqual(["The owner asked for exactly 0 new songs; this has 1. Replace 1 of them with songs from the owner's history."]);
    expect(constraintErrors(set, c({ newSongs: 3 }))).toEqual(["The owner asked for exactly 3 new songs; this has 1. Add 2 verified songs the owner has never played."]);
  });

  test("newSongs larger than the set asks for more songs", () => {
    expect(constraintErrors(set.slice(0, 2), c({ newSongs: 5 }))).toEqual(["The owner asked for exactly 5 new songs; this has 0. Add 5 verified songs the owner has never played."]);
  });

  test("excluded songs and artists are named per track, including a featured artist", () => {
    const songs = [...set, song(5, "Pink Matter", ["Frank Ocean", "André 3000"], null)];
    const exclude = { artists: ["andré 3000"], songs: [{ songKey: WOODS, label: "Woods - Mac Miller" }] };
    expect(constraintErrors(songs, c({ exclude }))).toEqual([
      "Track 1: the owner excluded Woods. Replace it.",
      "Track 5: Pink Matter is by André 3000, whom the owner excluded. Replace it.",
    ]);
  });

  test("no constraints, no errors", () => {
    expect(constraintErrors(set, NO_CONSTRAINTS)).toEqual([]);
  });
});

describe("sets with constraints", () => {
  test("submit_set rejects a set over the artist cap with a precise error, then accepts the fix; the constraints are stored and stated", async () => {
    const fake = scripted(submit(lib(WOODS), lib(SURF), lib(NIGHTS)), submit(lib(WOODS), lib(NIGHTS), lib(DNA)));
    const { ctx, db } = featureCtx(fake.transport, CATALOG);
    seedLibrary(db);
    const { set } = await createSet(ctx, "night", undefined, undefined, { maxPerArtist: 1 });

    expect(toolResults(fake.requests[1]!)[0]!.value).toEqual({
      accepted: false,
      errors: ["Mac Miller has 2 tracks (tracks 1, 2); the owner allows at most 1 per artist. Replace 1 of them."],
    });
    expect(set.items.map((i) => i.name)).toEqual(["Woods", "Nights", "DNA."]);
    expect(set.constraints).toEqual({ ...NO_CONSTRAINTS, maxPerArtist: 1 });
    expect(JSON.stringify(fake.requests[0]!.messages[0])).toContain("<set_constraints>\\nAt most 1 song per artist, counted by primary artist.\\n</set_constraints>");
  });

  test("newSongs counts verified new songs", async () => {
    const fake = scripted(
      toolCall("verify_new_song", { title: "Good News", artist: "Mac Miller" }),
      submit(lib(WOODS), lib(NIGHTS)),
      submit(lib(WOODS), fresh("g1")),
    );
    const { ctx, db } = featureCtx(fake.transport, CATALOG);
    seedLibrary(db);
    const { set } = await createSet(ctx, "night", undefined, undefined, { newSongs: 1 });
    expect(toolResults(fake.requests[2]!)[0]!.value.errors).toEqual(["The owner asked for exactly 1 new song; this has 0. Add 1 verified song the owner has never played."]);
    expect(set.items.map((i) => i.kind)).toEqual(["library", "new"]);
  });

  test("an excluded artist's library songs are hidden from find_songs and rejected on submit", async () => {
    const fake = scripted(toolCall("find_songs", {}), submit(lib(NIGHTS), lib(WOODS)), submit(lib(WOODS)));
    const { ctx, db } = featureCtx(fake.transport, CATALOG);
    seedLibrary(db);
    await createSet(ctx, "night", undefined, undefined, { exclude: { artists: ["Frank Ocean"], songs: [] } });

    const found = (toolResults(fake.requests[1]!)[0]!.value.songs as { name: string }[]).map((s) => s.name);
    expect(found).toContain("Woods");
    expect(found).not.toContain("Nights");
    expect(toolResults(fake.requests[2]!)[0]!.value.errors).toEqual(["Track 1: Nights is by Frank Ocean, whom the owner excluded. Replace it."]);
  });

  test("defaults from settings apply to a new set; given fields override them", async () => {
    const env = { DEFAULT_MAX_PER_ARTIST: "2", DEFAULT_NEW_SONGS: "3" };
    const fake = scripted(submit(lib(WOODS)), toolCall("verify_new_song", { title: "Good News", artist: "Mac Miller" }), submit(lib(WOODS), fresh("g1")));
    const one = featureCtx(fake.transport, CATALOG, { ...env, DEFAULT_NEW_SONGS: "1" });
    seedLibrary(one.db);
    expect((await createSet(one.ctx, "night")).set.constraints).toEqual({ ...NO_CONSTRAINTS, maxPerArtist: 2, newSongs: 1 });
    expect(toolResults(fake.requests[1]!)[0]!.value.errors).toEqual(["The owner asked for exactly 1 new song; this has 0. Add 1 verified song the owner has never played."]);

    const two = featureCtx(scripted(submit(lib(WOODS))).transport, CATALOG, env);
    seedLibrary(two.db);
    const { set } = await createSet(two.ctx, "night", undefined, undefined, { newSongs: null });
    expect(set.constraints).toEqual({ ...NO_CONSTRAINTS, maxPerArtist: 2 });
  });

  test("a refinement keeps the set's constraints and states them again", async () => {
    const create = scripted(submit(lib(WOODS), lib(NIGHTS)));
    const env = featureCtx(create.transport, CATALOG);
    seedLibrary(env.db);
    const { set } = await createSet(env.ctx, "night", undefined, undefined, { maxPerArtist: 1 });

    const refine = scripted(submit(lib(WOODS), lib(SURF), lib(NIGHTS)), submit(lib(SURF), lib(NIGHTS)));
    env.ctx.llm = new Llm(env.db, env.ctx.settings, () => refine.transport, env.ctx.now);
    const result = await refineSet(env.ctx, set.id, "longer");

    expect(JSON.stringify(refine.requests[0]!.messages.at(-1))).toContain("At most 1 song per artist");
    expect(toolResults(refine.requests[1]!)[0]!.value.errors).toEqual(["Mac Miller has 2 tracks (tracks 1, 2); the owner allows at most 1 per artist. Replace 1 of them."]);
    expect(result.set.items.map((i) => i.name)).toEqual(["Surf", "Nights"]);
    expect(result.set.constraints.maxPerArtist).toBe(1);
  });

  test("set_constraints changes the set's constraints mid-run, and submit_set checks the new ones", async () => {
    const create = scripted(submit(lib(WOODS), lib(NIGHTS)));
    const env = featureCtx(create.transport, CATALOG);
    seedLibrary(env.db);
    const { set } = await createSet(env.ctx, "night", undefined, undefined, { maxPerArtist: 1 });

    const refine = scripted(toolCall("set_constraints", { maxPerArtist: 2 }), submit(lib(WOODS), lib(SURF), lib(NIGHTS)));
    env.ctx.llm = new Llm(env.db, env.ctx.settings, () => refine.transport, env.ctx.now);
    const result = await refineSet(env.ctx, set.id, "up to 2 per artist is fine");

    expect(toolResults(refine.requests[1]!)[0]!.value).toEqual({ constraints: { ...NO_CONSTRAINTS, maxPerArtist: 2 } });
    expect(result.set.items.map((i) => i.name)).toEqual(["Woods", "Surf", "Nights"]);
    expect(getSet(env.db, set.id)!.constraints.maxPerArtist).toBe(2);
  });

  test("updating constraints changes neither the songs nor the version", async () => {
    const env = featureCtx(scripted(submit(lib(WOODS), lib(SURF))).transport, CATALOG);
    seedLibrary(env.db);
    const { set } = await createSet(env.ctx, "night");
    const updated = updateSetConstraints(env.db, set.id, { maxPerArtist: 1, exclude: { artists: ["Drake"], songs: [] } });
    expect(updated.version).toBe(1);
    expect(updated.items.map((i) => i.name)).toEqual(["Woods", "Surf"]);
    expect(updated.constraints).toEqual({ maxPerArtist: 1, maxPerAlbum: null, newSongs: null, exclude: { artists: ["Drake"], songs: [] } });
  });
});

describe("set constraints over HTTP", () => {
  test("PATCH /api/sets/:id/constraints merges the patch, and rejects bad values", async () => {
    const app = testApp({}, fetch, scripted(submit(lib(WOODS))).transport);
    seedLibrary(app.db);
    const cookie = `encore_session=${createSession(app.db)}`;
    const created = (await (await app.request("/api/sets", { json: { request: "night", constraints: { maxPerAlbum: 2 } }, headers: { cookie } })).json()) as { set: { id: number } };
    const patch = (body: unknown) => app.request(`/api/sets/${created.set.id}/constraints`, { method: "PATCH", body: JSON.stringify(body), headers: { cookie, "content-type": "application/json" } });

    const res = await patch({ maxPerArtist: 3 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { constraints: Constraints }).constraints).toEqual({ ...NO_CONSTRAINTS, maxPerArtist: 3, maxPerAlbum: 2 });
    expect((await patch({ maxPerArtist: 0 })).status).toBe(400);
    expect((await patch({ newSongs: 81 })).status).toBe(400);
    expect((await app.request("/api/sets/999/constraints", { method: "PATCH", body: "{}", headers: { cookie, "content-type": "application/json" } })).status).toBe(404);
  });
});

describe("picks with default constraints", () => {
  test("the default album cap applies to picks; the artist cap and newSongs do not", () => {
    const constraints = picksConstraints({ maxPerArtist: 4, maxPerAlbum: 1, newSongs: 2 });
    expect(constraints).toEqual({ ...NO_CONSTRAINTS, maxPerAlbum: 1 });

    const { db, ctx } = featureCtx(null);
    const v = new CandidateVerifier(db, ctx.spotify, blockedSets(db), 0);
    for (const [id, name, artist] of [["s1", "One", "A"], ["s2", "Two", "B"]] as const)
      v.verified.set(uri(id), { uri: uri(id), songKey: songKey(name, artist), name, artists: [artist], album: "Soundtrack", albumArtUrl: null, releaseDate: null, durationMs: 1, heard: false, plays: 0 });
    const src = "https://src.test/a-b";
    const input = { picks: ["s1", "s2"].map((id) => ({ uri: uri(id), reason: "r", distance: "near" as const, sourceUrl: src })) };
    const errors = validatePicks(db, blockedSets(db), v, input, { count: 2, far: 0 }, "w", 0, new Map([[src, "One by A, Two by B"]]), constraints).errors;
    expect(errors).toEqual(["The album Soundtrack has 2 picks (picks 1, 2); the owner allows at most 1 per album. Replace 1 of them."]);
  });
});

describe("DJ re-plans keep within constraints", () => {
  const u = (s: { id: string }) => uri(s.id);

  test("songs a re-plan adds past a cap, by an excluded artist or blocked are dropped; planned songs stay and count", () => {
    const { db } = featureCtx(null);
    seedLibrary(db);
    addBlock(db, "song", DNA, "DNA.", "test", 0);
    const input = { exclude: [u(SONGS.woods)], upcoming: [u(SONGS.nights)] };
    const proposed = [u(SONGS.nights), u(SONGS.surf), u(SONGS.dna)];
    expect(constrainTail(db, input, proposed, c({ maxPerArtist: 1 }))).toEqual([u(SONGS.nights)]);
    expect(constrainTail(db, input, proposed, c({ maxPerArtist: 2 }))).toEqual([u(SONGS.nights), u(SONGS.surf)]);
    expect(constrainTail(db, { exclude: [], upcoming: [] }, [u(SONGS.nights), u(SONGS.surf)], c({ exclude: { artists: ["frank ocean"], songs: [] } }))).toEqual([u(SONGS.surf)]);
    expect(constrainTail(db, { exclude: [], upcoming: [u(SONGS.woods), u(SONGS.surf)] }, [u(SONGS.woods), u(SONGS.surf)], c({ maxPerArtist: 1 }))).toEqual([u(SONGS.woods), u(SONGS.surf)]);
  });

  test("a session uses its set's constraints, else the defaults", async () => {
    const env = featureCtx(scripted(submit(lib(WOODS))).transport, CATALOG);
    seedLibrary(env.db);
    const { set } = await createSet(env.ctx, "night", undefined, undefined, { maxPerAlbum: 1 });
    const session = (id: number) => env.db.insert(djSessions).values({ id, playlistId: "p", status: "active", uris: [], position: 0, outcomes: [], startedAt: 0, updatedAt: 0 }).run();
    session(1);
    session(2);
    env.db.insert(setSessions).values({ sessionId: 1, setId: set.id, version: 1, startedAt: 0 }).run();
    const defaults = { maxPerArtist: 3, maxPerAlbum: null, newSongs: null };
    expect(sessionConstraints(env.db, 1, defaults)).toEqual({ ...NO_CONSTRAINTS, maxPerAlbum: 1 });
    expect(sessionConstraints(env.db, 2, defaults)).toEqual({ ...NO_CONSTRAINTS, maxPerArtist: 3 });
  });
});
