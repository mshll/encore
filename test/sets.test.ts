import { describe, expect, test } from "bun:test";
import { Llm } from "../src/llm/client";
import { outcomeOf } from "../src/library/outcomes";
import { songKey } from "../src/plays/song";
import { refreshSetOutcomes } from "../src/sets/outcomes";
import { saveSetPlaylist } from "../src/sets/playlist";
import { createSet, directionConflict, getSet, listSets, refineSet, SetNotBuiltError } from "../src/sets/service";
import { upsertTags } from "../src/tags/service";
import { sql } from "drizzle-orm";
import { play, seed, track, uri } from "./helpers";
import { featureCtx, message, scripted, seedLibrary, text, toolCall, toolResults, toolUse, type FakeSpotifyTrack } from "./llmFakes";

const CATALOG: FakeSpotifyTrack[] = [
  { id: "w1", name: "Woods", artists: ["Mac Miller"], album: "Circles" },
  { id: "g1", name: "Good News", artists: ["Mac Miller"], album: "Circles" },
  { id: "g2", name: "Good News", artists: ["Mac Miller"], album: "Good News (Live)" },
];

const WOODS = songKey("Woods", "Mac Miller");
const SURF = songKey("Surf", "Mac Miller");

function buildScript() {
  return scripted(
    message(
      [
        toolUse("find_songs", { artists: ["Mac Miller"] }),
        toolUse("verify_new_song", { title: "Moonlit Ferry", artist: "Nobody Real" }),
        toolUse("verify_new_song", { title: "Woods", artist: "Mac Miller" }),
        toolUse("verify_new_song", { title: "Good News", artist: "Mac Miller" }),
      ],
      "tool_use",
    ),
    toolCall("submit_set", {
      title: "Late drive",
      description: "Night roads.",
      items: [
        { source: "library", songKey: WOODS, reason: "Finished 10 of 10 night plays." },
        { source: "new", uri: uri("w1"), reason: "Pretend new." },
        { source: "new", uri: uri("zz"), reason: "Never verified." },
        { source: "library", songKey: "made up|nobody", reason: "Hallucinated." },
      ],
    }),
    toolCall("submit_set", {
      title: "Late drive",
      description: "Night roads.",
      items: [
        { source: "library", songKey: WOODS, reason: "Finished 10 of 10 night plays." },
        { source: "new", uri: uri("g1"), reason: "Same album as Woods, never played." },
      ],
    }),
  );
}

async function builtSet() {
  const fake = buildScript();
  const env = featureCtx(fake.transport, CATALOG);
  seedLibrary(env.db);
  const result = await createSet(env.ctx, "late drive, like my Mac Miller era");
  return { ...env, fake, result };
}

describe("set building tool loop", () => {
  test("a hallucinated song fails verification and is never accepted", async () => {
    const { fake } = await builtSet();
    const [found, hallucinated, heard, fresh] = toolResults(fake.requests[1]!);
    expect((found!.value.songs as { songKey: string }[]).map((s) => s.songKey)).toContain(WOODS);
    expect(hallucinated).toMatchObject({ isError: false, value: { ok: false, reason: "Not found on Spotify" } });
    expect(heard!.value).toMatchObject({ ok: true, song: { name: "Woods", heard: true, plays: 20 } });
    expect(fresh!.value).toMatchObject({ ok: true, song: { name: "Good News", album: "Circles", heard: false } });
  });

  test("submission rejects an already-heard 'new' song, an unverified uri and an unknown library song", async () => {
    const { fake } = await builtSet();
    const [rejected] = toolResults(fake.requests[2]!);
    const errors = rejected!.value.errors as string[];
    expect(rejected!.value.accepted).toBe(false);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("Track 2: the owner has already played Woods");
    expect(errors[1]).toContain("Track 3: uri");
    expect(errors[2]).toContain("Track 4: songKey");
  });

  test("the accepted set is stored with reasons and only GET searches reach Spotify", async () => {
    const { result, spotifyCalls, fake } = await builtSet();
    expect(fake.remaining()).toBe(0);
    expect(result.reply).toBeNull();
    expect(result.set).toMatchObject({ title: "Late drive", version: 1, playlist: null });
    expect(result.set.items.map((i) => [i.kind, i.name, i.reason])).toEqual([
      ["library", "Woods", "Finished 10 of 10 night plays."],
      ["new", "Good News", "Same album as Woods, never played."],
    ]);
    expect(spotifyCalls.map((c) => c.method)).toEqual(["GET", "GET", "GET"]);
    expect(spotifyCalls.every((c) => c.path.startsWith("/v1/search?") && c.path.includes("limit=10"))).toBe(true);
    expect(result.set.conversation[0]).toMatchObject({ role: "owner", text: "late drive, like my Mac Miller era" });
  });

  test("a live version is rejected unless asked for", async () => {
    const fake = scripted(toolCall("verify_new_song", { title: "Good News", artist: "Mac Miller" }), message([text("ok")]));
    const { ctx, db } = featureCtx(fake.transport, [CATALOG[2]!]);
    seedLibrary(db);
    await createSet(ctx, "x");
    expect(toolResults(fake.requests[1]!)[0]!.value).toMatchObject({ ok: false });
  });

  test("a run that neither submits nor replies leaves nothing behind", async () => {
    const { ctx, db } = featureCtx(scripted(message([])).transport, CATALOG);
    seedLibrary(db);
    await expect(createSet(ctx, "x")).rejects.toBeInstanceOf(SetNotBuiltError);
    expect(listSets(db, 10, 0).total).toBe(0);
  });
});

describe("refine", () => {
  test("a refinement resubmits on the stored thread, reusing songs verified earlier", async () => {
    const env = await builtSet();
    const firstUser = env.fake.requests[0]!.messages[0];
    const refine = scripted(
      toolCall("submit_set", {
        title: "Late drive, brighter",
        description: "Less sad.",
        items: [
          { source: "library", songKey: SURF, reason: "Valence 4 of 5, never skipped." },
          { source: "new", uri: uri("g1"), reason: "Kept from v1." },
        ],
      }),
    );
    env.ctx.llm = new Llm(env.db, env.ctx.config, refine.transport, env.ctx.now);
    const result = await refineSet(env.ctx, env.result.set.id, "less sad");
    expect(result.changed).toBe(true);
    expect(result.set.version).toBe(2);
    expect(result.set.items.map((i) => i.name)).toEqual(["Surf", "Good News"]);
    const req = refine.requests[0]!;
    expect(req.messages[0]).toEqual(firstUser!);
    expect(JSON.stringify(req.messages.at(-1))).toContain("<owner_message>\\nless sad\\n</owner_message>");
    expect(env.spotifyCalls).toHaveLength(3);
    expect(result.set.conversation.map((t) => t.role)).toEqual(["owner", "owner"]);
  });

  test("a question back to the owner leaves the set unchanged", async () => {
    const env = await builtSet();
    const refine = scripted(message([text("Swap for something faster or something brighter?")]));
    env.ctx.llm = new Llm(env.db, env.ctx.config, refine.transport, env.ctx.now);
    const result = await refineSet(env.ctx, env.result.set.id, "change track 2");
    expect(result).toMatchObject({ changed: false, reply: "Swap for something faster or something brighter?" });
    expect(result.set.version).toBe(1);
  });
});

describe("refine applies a direction to the whole set", () => {
  const MISSED = songKey("Missed Calls", "Mac Miller");

  async function sadSet() {
    const create = scripted(
      toolCall("submit_set", {
        title: "Late drive",
        description: "Night roads.",
        items: [
          { source: "library", songKey: WOODS, reason: "Finished at night." },
          { source: "library", songKey: MISSED, reason: "Night favourite." },
          { source: "library", songKey: SURF, reason: "Bright closer." },
        ],
      }),
    );
    const env = featureCtx(create.transport, CATALOG);
    seedLibrary(env.db);
    seed(env.db, [track("m1", "Missed Calls", "Mac Miller", "Faces", { durationMs: 200_000 })], [play("2026-01-12T20:00:00Z", uri("m1"), 200_000)]);
    upsertTags(env.db, [{ uri: uri("m1"), genres: ["hip-hop"], moods: ["sad", "melancholic"], energy: 2, valence: 1, language: "en", model: "test", confidence: "high" }]);
    const { set } = await createSet(env.ctx, "late drive");
    return { ...env, set };
  }

  const lessSad = { avoidMoods: ["sad", "melancholic"] };
  const resubmit = (items: string[], extra: object = {}) =>
    toolCall("submit_set", { title: "Late drive", description: "Less sad.", items: items.map((k) => ({ source: "library", songKey: k, reason: "r" })), direction: lessSad, ...extra });

  test("a sad song the owner didn't name is rejected after 'less sad', and the set is rebuilt without it", async () => {
    const env = await sadSet();
    const refine = scripted(resubmit([WOODS, MISSED, SURF]), resubmit([SURF, WOODS]));
    env.ctx.llm = new Llm(env.db, env.ctx.config, refine.transport, env.ctx.now);
    const result = await refineSet(env.ctx, env.set.id, "less sad");
    const [first] = toolResults(refine.requests[1]!);
    expect(first!.value).toMatchObject({ accepted: false });
    expect(first!.value.errors).toEqual(["Track 2: Missed Calls conflicts with the direction (tagged sad, melancholic). Replace it, or list its songKey in keep if the owner asked to keep it."]);
    expect(result.set.items.map((i) => i.name)).toEqual(["Surf", "Woods"]);
    expect(JSON.stringify(refine.requests[0]!.system)).toContain("applies to the whole set");
  });

  test("a song the owner asked to keep stays", async () => {
    const env = await sadSet();
    const refine = scripted(resubmit([WOODS, MISSED, SURF], { keep: [MISSED] }));
    env.ctx.llm = new Llm(env.db, env.ctx.config, refine.transport, env.ctx.now);
    const result = await refineSet(env.ctx, env.set.id, "less sad, but keep Missed Calls");
    expect(result.set.items.map((i) => i.name)).toEqual(["Woods", "Missed Calls", "Surf"]);
  });

  test("energy and valence limits are checked against tags", () => {
    const tags = { genres: [], subgenre: null, moods: ["chill"], energy: 2, valence: 4, language: "en" };
    expect(directionConflict(tags, { energyMin: 3 })).toBe("energy 2 is below 3");
    expect(directionConflict(tags, { valenceMax: 3 })).toBe("valence 4 is above 3");
    expect(directionConflict(tags, { avoidMoods: ["sad"] })).toBeNull();
    expect(directionConflict(null, { energyMin: 5 })).toBeNull();
  });
});

describe("artwork", () => {
  test("set items carry album art and artist images in one response", async () => {
    const { result, db } = await builtSet();
    db.run(sql`update tracks set album_art_url = 'https://img.test/woods-any.jpg' where uri = ${uri("w1")}`);
    db.run(sql`insert into artists (id, name, image_url) values ('mm', 'Mac Miller', 'https://img.test/mac.jpg')`);
    db.run(sql`insert into track_artists (track_uri, artist_id, position) values (${uri("w1")}, 'mm', 0)`);
    const items = getSet(db, result.set.id)!.items;
    expect(items.map((i) => [i.name, i.albumArtUrl, i.artistImageUrl])).toEqual([
      ["Woods", "https://img.test/woods-any.jpg", "https://img.test/mac.jpg"],
      ["Good News", "https://img.test/g1.jpg", "https://img.test/mac.jpg"],
    ]);
  });
});

describe("save to playlist", () => {
  test("first save creates one private playlist; later saves update it in place", async () => {
    const env = await builtSet();
    const id = env.result.set.id;
    env.spotifyCalls.length = 0;
    const first = await saveSetPlaylist(env.db, env.ctx.spotify, id, env.ctx.now());
    expect(first).toEqual({ playlistId: "pl1", playlistUrl: "https://open.spotify.com/playlist/pl1", tracks: 2 });
    expect(env.spotifyCalls).toEqual([
      { method: "POST", path: "/v1/me/playlists", body: { name: "Late drive", description: "Night roads.", public: false } },
      { method: "PUT", path: "/v1/playlists/pl1/items", body: { uris: [uri("w1"), uri("g1")] } },
    ]);
    expect(getSet(env.db, id)!.playlist).toMatchObject({ id: "pl1", savedVersion: 1, outdated: false });

    const refine = scripted(toolCall("submit_set", { title: "Late drive 2", description: "d", items: [{ source: "library", songKey: SURF, reason: "r" }] }));
    env.ctx.llm = new Llm(env.db, env.ctx.config, refine.transport, env.ctx.now);
    await refineSet(env.ctx, id, "only Surf");
    expect(getSet(env.db, id)!.playlist).toMatchObject({ savedVersion: 1, outdated: true });

    env.spotifyCalls.length = 0;
    await saveSetPlaylist(env.db, env.ctx.spotify, id, env.ctx.now());
    expect(env.spotifyCalls).toEqual([
      { method: "PUT", path: "/v1/playlists/pl1", body: { name: "Late drive 2", description: "d" } },
      { method: "PUT", path: "/v1/playlists/pl1/items", body: { uris: [uri("s1")] } },
    ]);
    expect(getSet(env.db, id)!.playlist).toMatchObject({ savedVersion: 2, outdated: false });
  });
});

describe("outcome tracking", () => {
  test("export rows use Spotify's skip flag and play share", () => {
    const base = { ts: 0, day: "2026-01-01", source: "export" as const, reason_end: null, duration_ms: 200_000, prev_ts: null };
    expect(outcomeOf({ ...base, ms_played: 200_000, skipped: 1 })).toBe("skipped");
    expect(outcomeOf({ ...base, ms_played: 10_000, skipped: 0, reason_end: "trackdone" })).toBe("finished");
    expect(outcomeOf({ ...base, ms_played: 170_000, skipped: 0 })).toBe("finished");
    expect(outcomeOf({ ...base, ms_played: 100_000, skipped: 0 })).toBe("skipped");
  });

  test("API rows compare the gap since the previous play with the duration", () => {
    const base = { day: "2026-01-01", source: "api" as const, ms_played: null, skipped: null, reason_end: null, duration_ms: 200_000 };
    expect(outcomeOf({ ...base, ts: 200_000, prev_ts: 0 })).toBe("finished");
    expect(outcomeOf({ ...base, ts: 30_000, prev_ts: 0 })).toBe("skipped");
    expect(outcomeOf({ ...base, ts: 30_000, prev_ts: null })).toBe("unknown");
  });

  test("set items count plays after the set was saved", async () => {
    const env = await builtSet();
    await saveSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());
    seed(
      env.db,
      [track("g1", "Good News", "Mac Miller", "Circles", { durationMs: 200_000 })],
      [
        play("2026-01-15T10:00:00Z", uri("g1"), 200_000),
        play("2026-02-05T10:00:00Z", uri("g1"), 200_000),
        play("2026-02-06T10:00:00Z", uri("g1"), 5_000, { skipped: true }),
      ],
    );
    refreshSetOutcomes(env.db);
    const items = getSet(env.db, env.result.set.id)!.items;
    expect(items[1]!.outcome).toMatchObject({ plays: 2, finished: 1, skipped: 1, firstPlayedAt: "2026-02-05T10:00:00.000Z" });
    expect(items[0]!.outcome.plays).toBe(0);
  });
});
