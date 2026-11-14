import { describe, expect, test } from "bun:test";
import { createDiscord } from "../src/discord";
import { publishAssistantPosts } from "../src/discord/posts";
import { InteractionType, ResponseType, type Interaction } from "../src/discord/types";
import { digests, llmCalls, picks, releases, spotifyAuth } from "../src/db/schema";
import type { LlmTransport } from "../src/llm/client";
import { listBlocks } from "../src/library/blocks";
import { weekOf } from "../src/picks/service";
import { songKey } from "../src/plays/song";
import { createServices } from "../src/services";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { testConfig, testDb, TZ, uri, testSettings } from "./helpers";
import { clock, fakeSpotifyFetch, message, scripted, seedLibrary, text, toolCall } from "./llmFakes";

const OWNER = "42";

function setup(transport: LlmTransport | null = null, env: Record<string, string> = {}) {
  const db = testDb();
  const config = testConfig({ DISCORD_APPLICATION_ID: "1", DISCORD_PUBLIC_KEY: "a".repeat(64), DISCORD_OWNER_ID: OWNER, DISCORD_BOT_TOKEN: "bot", DISCORD_CHANNEL_ID: "7", ...env });
  const settings = testSettings(db, config);
  const time = clock("2026-02-01T12:00:00Z");
  db.insert(spotifyAuth).values({ id: 1, accessToken: "tok", refreshToken: "ref", expiresAt: 9e15, scope: "", clientId: "test-client", updatedAt: 0 }).run();
  const spotifyFake = fakeSpotifyFetch([]);
  const discordCalls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://discord.com")) return spotifyFake.fetchFn(input, init);
    const body = init?.body instanceof FormData ? { ...JSON.parse(String(init.body.get("payload_json"))), files: [...init.body.keys()].filter((k) => k.startsWith("files[")) } : JSON.parse(String(init?.body ?? "null"));
    discordCalls.push({ method: init?.method ?? "GET", path: url.replace("https://discord.com/api/v10", ""), body });
    return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
  }) as typeof fetch;
  const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, settings, fetchFn, time.now), settings, fetchFn, time.now);
  const services = createServices(db, config, settings, spotify, { now: time.now, llmTransport: transport });
  const ctx = { db, config, settings, services, now: time.now };
  const discord = createDiscord(settings.get().discord!, ctx, fetchFn);
  seedLibrary(db);
  const run = async (interaction: Partial<Interaction>) => {
    const reply = await discord.interactions.handle({ id: "i", token: "tok", application_id: "1", member: { user: { id: OWNER } }, ...interaction } as Interaction);
    await discord.interactions.whenIdle();
    return reply;
  };
  const command = (name: string, options: Record<string, string> = {}) =>
    run({ type: InteractionType.Command, data: { name, options: Object.entries(options).map(([n, value]) => ({ name: n, value })) } });
  const button = (custom_id: string) => run({ type: InteractionType.Component, data: { custom_id } });
  const edited = () => discordCalls.filter((c) => c.method === "PATCH").at(-1)!.body;
  return { db, ctx, discord, command, button, edited, discordCalls, spotifyCalls: spotifyFake.calls, time };
}

function insertPicks(db: ReturnType<typeof testDb>, week: string) {
  return [1, 2].map((n) =>
    db
      .insert(picks)
      .values({
        week,
        position: n,
        uri: uri(`p${n}`),
        songKey: `song ${n}|artist ${n}`,
        name: `Song ${n}`,
        artist: `Artist ${n}`,
        album: null,
        releaseDate: null,
        albumArtUrl: `https://img.test/p${n}.jpg`,
        reason: `Reason ${n}.`,
        sourceUrl: `https://src.test/${n}`,
        sourceTitle: `Source ${n}`,
        distance: n === 2 ? "far" : "near",
        state: "new",
        stateAt: 0,
        createdAt: Date.parse("2026-02-01T10:00:00Z"),
      })
      .returning()
      .get(),
  );
}

describe("assistant on Discord", () => {
  test("/set defers, then shows the title, count, first tracks with art and the three buttons", async () => {
    const fake = scripted(
      toolCall("submit_set", {
        title: "Night *drive*",
        description: "Roads.",
        items: [
          { source: "library", songKey: songKey("Woods", "Mac Miller"), reason: "Finished at night." },
          { source: "library", songKey: songKey("Surf", "Mac Miller"), reason: "Keeper." },
        ],
      }),
    );
    const { command, edited } = setup(fake.transport);
    expect(await command("set", { moment: "night drive" })).toEqual({ type: ResponseType.DeferredMessage });
    const body = edited() as { embeds: { title: string; url?: string; footer?: { text: string } }[]; components: { components: { label: string; custom_id?: string; url?: string }[] }[] };
    expect(body.embeds[0]).toMatchObject({ title: "Night \\*drive\\*", url: "http://localhost:8888/sets/1", footer: { text: "2 tracks, 0 new" } });
    expect(body.embeds.slice(1).map((e) => e.title)).toEqual(["1. Woods", "2. Surf"]);
    expect(body.components[0]!.components.map((b) => b.custom_id ?? b.url)).toEqual(["setsave:1", "setplay:1", "http://localhost:8888/sets/1"]);
  });

  test("/picks shows one embed per pick with art, reason and source, and Save / Not now / Never per pick", async () => {
    const { command, db, time } = setup();
    const [first] = insertPicks(db, weekOf(time.now(), TZ));
    const reply = await command("picks");
    expect(reply.type).toBe(ResponseType.Message);
    const data = reply.data as { embeds: { title: string; description: string; thumbnail?: { url: string } }[]; components: { components: { custom_id: string }[] }[] };
    expect(data.embeds[0]).toMatchObject({ title: "1. Song 1", description: "Reason 1.\n[Source 1](https://src.test/1)", thumbnail: { url: "https://img.test/p1.jpg" } });
    expect(data.components[0]!.components.map((b) => b.custom_id)).toEqual([`pick:${first!.id}:save`, `pick:${first!.id}:notnow`, `pick:${first!.id}:never`]);
  });

  test("pick buttons set the state; Save also saves the song to the library; Never blocks it", async () => {
    const { button, db, time, spotifyCalls, edited } = setup();
    const [first, second] = insertPicks(db, weekOf(time.now(), TZ));
    await button(`pick:${first!.id}:save`);
    expect(spotifyCalls.map((c) => `${c.method} ${c.path}`)).toEqual([`PUT /v1/me/library?uris=${encodeURIComponent(uri("p1"))}`]);
    expect(edited()).toMatchObject({ content: "Saved to your library: Song 1 by Artist 1.", flags: 64 });
    await button(`pick:${second!.id}:never`);
    expect(listBlocks(db).map((b) => b.key)).toEqual(["song 2|artist 2"]);
    await button("pick:999:save");
    expect(edited()).toMatchObject({ content: "That no longer exists.", flags: 64 });
  });

  test("/ask answers in plain text; a spent budget is explained instead of a generic error", async () => {
    const ok = setup(scripted(message([text("You played Woods 20 times.")])).transport);
    await ok.command("ask", { question: "top song?" });
    expect(ok.edited()).toMatchObject({ content: "You played Woods 20 times." });

    const broke = setup(scripted().transport, { MONTHLY_BUDGET_USD: "1" });
    broke.db.insert(llmCalls).values({ ts: broke.time.now(), month: "2026-02", feature: "ask", requestedModel: "m", model: "m", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, usd: 1, stopReason: "end_turn", durationMs: 0 }).run();
    await broke.command("ask", { question: "q" });
    expect(broke.edited()).toMatchObject({ content: "This month's Claude budget is used up ($1.00 of $1).", flags: 64 });
  });

  test("weekly posts: picks, then the digest with new releases, each once per period", async () => {
    const { ctx, discord, db, time, discordCalls } = setup();
    insertPicks(db, weekOf(time.now(), TZ));
    db.insert(digests)
      .values({ kind: "weekly", periodKey: "2026-01-31", fromDay: "2026-01-25", toDay: "2026-01-31", facts: {}, text: "A quiet week.", model: "m", createdAt: time.now() })
      .run();
    db.insert(releases)
      .values({ id: "alb1", uri: "spotify:album:alb1", artistId: "a", artistName: "Artist", name: "New EP", albumType: "single", releaseDate: "2026-01-30", totalTracks: 3, imageUrl: null, firstSeenAt: Date.parse("2026-01-30T10:00:00Z"), isNew: true })
      .run();
    expect(await publishAssistantPosts(discord, ctx)).toEqual({ posted: ["picks:2026-01-26", "weekly:2026-01-31"] });
    expect(await publishAssistantPosts(discord, ctx)).toEqual({ posted: [] });
    const posts = discordCalls.filter((c) => c.method === "POST");
    expect(posts.map((p) => p.path)).toEqual(["/channels/7/messages", "/channels/7/messages"]);
    expect(posts[1]!.body).toMatchObject({
      content: "Your week, 25 – 31 Jan 2026\n\nA quiet week.",
      embeds: [{ image: { url: "attachment://recap.png" } }, { title: "New releases from artists you play", description: "[New EP](https://open.spotify.com/album/alb1) by Artist, single 30 Jan 2026" }],
      attachments: [{ id: 0, filename: "recap.png" }],
      files: ["files[0]"],
      allowed_mentions: { parse: [] },
    });
  });
});
