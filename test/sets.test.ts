import { describe, expect, test } from "bun:test";
import { Llm } from "../src/llm/client";
import { songKey } from "../src/plays/song";
import { refreshSetOutcomes } from "../src/sets/outcomes";
import { saveSetPlaylist, syncSetPlaylist } from "../src/sets/playlist";
import { createSet, diffSets, directionConflict, getSet, listSets, pinSetItem, refineSet, removeSetItem, SetItemNotFoundError, SetNotBuiltError } from "../src/sets/service";
import { upsertTags } from "../src/tags/service";
import { sql } from "drizzle-orm";
import { sets, spotifyAuth } from "../src/db/schema";
import { SpotifyClient } from "../src/spotify/client";
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
      "tool_calls",
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
  test("find_songs tells Claude how a song is played in words, and a reason carrying an internal id is sent back", async () => {
    const fake = scripted(
      toolCall("find_songs", { artists: ["Mac Miller"] }),
      toolCall("submit_set", { title: "Night", description: "Late.", items: [{ source: "library", songKey: WOODS, reason: "A wrong_moment song that works at night." }] }),
      toolCall("submit_set", { title: "Night", description: "Late.", items: [{ source: "library", songKey: WOODS, reason: "Played through at night, skipped in the morning." }] }),
    );
    const env = featureCtx(fake.transport, CATALOG);
    seedLibrary(env.db);

    await createSet(env.ctx, "late night");
    const found = toolResults(fake.requests[1]!)[0]!.value.songs as { name: string; pattern: string }[];
    const rejected = toolResults(fake.requests[2]!)[0]!.value;

    expect([found.find((s) => s.name === "Woods")!.pattern, rejected.accepted, rejected.errors]).toEqual([
      "played through at some times, skipped at others",
      false,
      ["Track 1: write the reason in plain words, without tool names, field names or ids such as wrong_moment."],
    ]);
  });

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
    env.ctx.llm = new Llm(env.db, env.ctx.settings, () => refine.transport, env.ctx.now);
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
    env.ctx.llm = new Llm(env.db, env.ctx.settings, () => refine.transport, env.ctx.now);
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
    env.ctx.llm = new Llm(env.db, env.ctx.settings, () => refine.transport, env.ctx.now);
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
    env.ctx.llm = new Llm(env.db, env.ctx.settings, () => refine.transport, env.ctx.now);
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
  test("library tracks carry the owner's listens and last play; the list carries up to 4 cover images", async () => {
    const { result, db } = await builtSet();
    db.run(sql`update tracks set album_art_url = 'https://img.test/woods.jpg' where uri = ${uri("w1")}`);
    const items = getSet(db, result.set.id)!.items;
    expect(items.map((i) => i.history)).toEqual([{ listens: 10, lastPlayed: "2026-01-10T20:00:00.000Z" }, null]);
    expect(listSets(db, 10, 0).items[0]!.covers).toEqual(["https://img.test/woods.jpg", "https://img.test/g1.jpg"]);
  });
});

describe("save to playlist", () => {
  test("first save creates one private playlist; later saves update it in place", async () => {
    const env = await builtSet();
    const id = env.result.set.id;
    env.spotifyCalls.length = 0;
    const first = await saveSetPlaylist(env.db, env.ctx.spotify, id, env.ctx.now());
    expect(first).toEqual({ playlistId: "pl1", playlistUrl: "https://open.spotify.com/playlist/pl1", tracks: 2, cover: { status: "missing_scope" } });
    expect(env.spotifyCalls).toEqual([
      { method: "POST", path: "/v1/me/playlists", body: { name: "Late drive", description: "Night roads.", public: false } },
      { method: "PUT", path: "/v1/playlists/pl1/items", body: { uris: [uri("w1"), uri("g1")] } },
    ]);
    expect(getSet(env.db, id)!.playlist).toMatchObject({ id: "pl1", savedVersion: 1, outdated: false });

    const refine = scripted(toolCall("submit_set", { title: "Late drive 2", description: "d", items: [{ source: "library", songKey: SURF, reason: "r" }] }));
    env.ctx.llm = new Llm(env.db, env.ctx.settings, () => refine.transport, env.ctx.now);
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

describe("playlist sync after a change", () => {
  test("a set never saved stays off Spotify", async () => {
    const env = await builtSet();
    env.spotifyCalls.length = 0;

    await syncSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());

    expect(env.spotifyCalls).toEqual([]);
  });

  test("a saved set that changed has its playlist updated in place", async () => {
    const env = await builtSet();
    const id = env.result.set.id;
    await saveSetPlaylist(env.db, env.ctx.spotify, id, env.ctx.now());
    removeSetItem(env.db, id, 1, env.ctx.now());
    env.spotifyCalls.length = 0;

    await syncSetPlaylist(env.db, env.ctx.spotify, id, env.ctx.now());

    expect(env.spotifyCalls).toContainEqual({ method: "PUT", path: "/v1/playlists/pl1/items", body: { uris: [uri("g1")] } });
    expect(getSet(env.db, id)!.playlist).toMatchObject({ savedVersion: 2, outdated: false });
  });

  test("a saved set with no change since the save sends nothing", async () => {
    const env = await builtSet();
    await saveSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());
    env.spotifyCalls.length = 0;

    await syncSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());

    expect(env.spotifyCalls).toEqual([]);
  });

  test("a failed update does not throw and leaves the set outdated", async () => {
    const env = await builtSet();
    const id = env.result.set.id;
    await saveSetPlaylist(env.db, env.ctx.spotify, id, env.ctx.now());
    removeSetItem(env.db, id, 1, env.ctx.now());
    const failing = (async () => new Response(JSON.stringify({ error: { message: "Server error" } }), { status: 500 })) as unknown as typeof fetch;
    const spotify = new SpotifyClient(env.db, env.auth, env.ctx.settings, failing, env.time.now);

    await syncSetPlaylist(env.db, spotify, id, env.ctx.now());

    expect(getSet(env.db, id)!.playlist).toMatchObject({ savedVersion: 1, outdated: true });
  });
});

describe("playlist cover", () => {
  const grant = (db: Awaited<ReturnType<typeof builtSet>>["db"], scope: string) => db.update(spotifyAuth).set({ scope }).run();
  const uploads = (calls: { method: string; path: string; body: unknown }[]) => calls.filter((c) => c.path === "/v1/playlists/pl1/images");

  test("the first save uploads the cover as base64 JPEG through the Web API", async () => {
    const env = await builtSet();
    grant(env.db, "ugc-image-upload playlist-modify-private");

    const result = await saveSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());

    const [upload] = uploads(env.spotifyCalls);
    expect(result.cover).toEqual({ status: "uploaded" });
    expect(upload!.method).toBe("PUT");
    expect(Buffer.from(upload!.body as string, "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  test("saving again with nothing that affects the cover changed does not upload it again", async () => {
    const env = await builtSet();
    grant(env.db, "ugc-image-upload");
    await saveSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());
    env.spotifyCalls.length = 0;

    const again = await saveSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());

    expect(again.cover).toEqual({ status: "unchanged" });
    expect(uploads(env.spotifyCalls)).toEqual([]);
  });

  test("a new title uploads a new cover", async () => {
    const env = await builtSet();
    grant(env.db, "ugc-image-upload");
    await saveSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());
    env.db.update(sets).set({ title: "Later drive" }).run();
    env.spotifyCalls.length = 0;

    const again = await saveSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());

    expect(again.cover).toEqual({ status: "uploaded" });
    expect(uploads(env.spotifyCalls)).toHaveLength(1);
  });

  test("without the image upload scope the cover is skipped", async () => {
    const env = await builtSet();
    grant(env.db, "playlist-modify-private");

    const result = await saveSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());

    expect(result.cover).toEqual({ status: "missing_scope" });
    expect(uploads(env.spotifyCalls)).toEqual([]);
  });

  test("a failed upload is reported and the playlist save still stands", async () => {
    const env = await builtSet();
    grant(env.db, "ugc-image-upload");
    const failing = (async (input: string | URL | Request, init?: RequestInit) =>
      String(input).endsWith("/images") ? new Response(JSON.stringify({ error: { message: "Bad image" } }), { status: 400 }) : env.fetchFn(input, init)) as typeof fetch;
    const spotify = new SpotifyClient(env.db, env.auth, env.ctx.settings, failing, env.time.now);

    const result = await saveSetPlaylist(env.db, spotify, env.result.set.id, env.ctx.now());
    const retry = await saveSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());

    expect(result).toMatchObject({ playlistId: "pl1", tracks: 2, cover: { status: "failed" } });
    expect(getSet(env.db, env.result.set.id)!.playlist).toMatchObject({ savedVersion: 1, outdated: false });
    expect(retry.cover).toEqual({ status: "uploaded" });
  });
});

describe("outcome tracking", () => {
  test("a play left in its outro counts for a set item as played through, not skipped", async () => {
    const env = await builtSet();
    await saveSetPlaylist(env.db, env.ctx.spotify, env.result.set.id, env.ctx.now());
    seed(
      env.db,
      [track("g1", "Good News", "Mac Miller", "Circles", { durationMs: 200_000 })],
      [play("2026-02-05T10:00:00Z", uri("g1"), 185_000, { skipped: true, reasonEnd: "fwdbtn" })],
    );

    refreshSetOutcomes(env.db);

    expect(getSet(env.db, env.result.set.id)!.items[1]!.outcome).toMatchObject({ plays: 1, finished: 1, skipped: 0 });
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
        play("2026-02-06T10:00:00Z", uri("g1"), 5_000, { skipped: true, reasonEnd: "fwdbtn" }),
      ],
    );
    refreshSetOutcomes(env.db);
    const items = getSet(env.db, env.result.set.id)!.items;
    expect(items[1]!.outcome).toMatchObject({ plays: 2, finished: 1, skipped: 1, firstPlayedAt: "2026-02-05T10:00:00.000Z" });
    expect(items[0]!.outcome.plays).toBe(0);
  });
});

describe("versions, pins and removal", () => {
  const t = (key: string) => ({ songKey: key, name: key.toUpperCase(), artist: "X" });

  test("a diff lists added, removed and moved songs, not songs shifted by an insert", () => {
    expect(diffSets([t("a"), t("b"), t("c"), t("d")], [t("b"), t("a"), t("c"), t("e")])).toEqual({
      added: [t("e")],
      removed: [t("d")],
      moved: [{ ...t("b"), from: 2, to: 1 }],
    });
    expect(diffSets([t("a"), t("b")], [t("n"), t("a"), t("b")])).toEqual({ added: [t("n")], removed: [], moved: [] });
  });

  test("a refinement records what it changed and the message that asked for it; the first build records nothing", async () => {
    const env = await builtSet();
    expect(env.result.set.changes).toEqual([]);
    const refine = scripted(
      toolCall("submit_set", {
        title: "Late drive",
        description: "Less sad.",
        items: [
          { source: "new", uri: uri("g1"), reason: "Kept." },
          { source: "library", songKey: SURF, reason: "Brighter." },
        ],
      }),
    );
    env.ctx.llm = new Llm(env.db, env.ctx.settings, () => refine.transport, env.ctx.now);
    const { set } = await refineSet(env.ctx, env.result.set.id, "less sad");
    expect(set.changes).toEqual([
      {
        version: 2,
        source: "claude",
        message: "less sad",
        added: [{ songKey: SURF, name: "Surf", artist: "Mac Miller" }],
        removed: [{ songKey: WOODS, name: "Woods", artist: "Mac Miller" }],
        moved: [],
        at: expect.any(String),
      },
    ]);
  });

  test("a pinned song left out of a refinement is rejected, and stays pinned in the accepted set", async () => {
    const env = await builtSet();
    const setId = env.result.set.id;
    expect(pinSetItem(env.db, setId, 1, true).items[0]).toMatchObject({ name: "Woods", pinned: true });
    const items = (keys: string[]) => keys.map((k) => ({ source: "library", songKey: k, reason: "r" }));
    const refine = scripted(
      toolCall("submit_set", { title: "Late drive", description: "d", items: items([SURF]) }),
      toolCall("submit_set", { title: "Late drive", description: "d", items: items([SURF, WOODS]) }),
    );
    env.ctx.llm = new Llm(env.db, env.ctx.settings, () => refine.transport, env.ctx.now);
    const { set } = await refineSet(env.ctx, setId, "more upbeat");
    expect(JSON.stringify(refine.requests[0]!.messages.at(-1))).toContain(`Pinned by the owner, keep in the set: Woods - Mac Miller (songKey ${WOODS})`);
    expect(toolResults(refine.requests[1]!)[0]!.value).toMatchObject({ accepted: false, errors: [expect.stringContaining("Woods (songKey woods|mac miller) is pinned by the owner")] });
    expect(set.items.map((i) => [i.name, i.pinned])).toEqual([
      ["Surf", false],
      ["Woods", true],
    ]);
  });

  test("removing a track renumbers the rest, bumps the version and records the owner's change", async () => {
    const env = await builtSet();
    const set = removeSetItem(env.db, env.result.set.id, 1, Date.parse("2026-11-14T10:00:00Z"));
    expect(set.version).toBe(2);
    expect(set.items.map((i) => [i.position, i.name])).toEqual([[1, "Good News"]]);
    expect(set.changes).toEqual([
      { version: 2, source: "owner", message: null, added: [], removed: [{ songKey: WOODS, name: "Woods", artist: "Mac Miller" }], moved: [], at: "2026-11-14T10:00:00.000Z" },
    ]);
    expect(() => removeSetItem(env.db, env.result.set.id, 5, Date.now())).toThrow(SetItemNotFoundError);
  });
});
