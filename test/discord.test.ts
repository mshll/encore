import { describe, expect, test } from "bun:test";
import { Passkeys } from "../src/auth/passkeys";
import { createDiscord } from "../src/discord";
import { errorMessage } from "../src/discord/interactions";
import { InteractionType, plain, type Interaction } from "../src/discord/types";
import { createApp } from "../src/http/app";
import { createJobs } from "../src/jobs/definitions";
import { createServices } from "../src/services";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { SpotifyBlockedError } from "../src/spotify/errors";
import { connectSpotify, jsonResponse, noContent, play, routeFetch, seed, testConfig, testDb, track, uri, type FetchCall } from "./helpers";

const OWNER = "470266318785085440";
const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as unknown as CryptoKeyPair;
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keyPair.publicKey)).toString("hex");

async function sign(body: string, timestamp = "1700000000") {
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, new TextEncoder().encode(timestamp + body));
  return { "x-signature-ed25519": Buffer.from(sig).toString("hex"), "x-signature-timestamp": timestamp };
}

function setup(respond: (call: FetchCall) => Response | undefined = () => undefined) {
  const db = testDb();
  const config = testConfig({ DISCORD_APPLICATION_ID: "123456789012345678", DISCORD_PUBLIC_KEY: publicKey, DISCORD_OWNER_ID: OWNER, DISCORD_BOT_TOKEN: "bot", DISCORD_CHANNEL_ID: "1" });
  connectSpotify(db);
  const { fn, calls } = routeFetch((call) => respond(call) ?? (call.url.includes("discord.com") ? jsonResponse({ id: "m1" }) : undefined));
  const spotifyAuth = new SpotifyAuth(db, config, fn);
  const spotify = new SpotifyClient(db, spotifyAuth, config, fn);
  const services = createServices(db, config, spotify);
  const discord = createDiscord(config.discord!, { db, config, services, now: Date.now }, fn);
  const app = createApp({ db, config, passkeys: new Passkeys(db, config), spotifyAuth, spotify, jobs: createJobs(db, config, spotifyAuth, spotify, services), services, discord, now: Date.now });
  const post = async (interaction: Partial<Interaction>, headers?: Record<string, string>) => {
    const body = JSON.stringify({ id: "i1", token: "tok", application_id: "123456789012345678", ...interaction });
    return app.request("/api/discord/interactions", { method: "POST", body, headers: { "content-type": "application/json", ...(headers ?? (await sign(body))) } });
  };
  return { db, app, post, calls, discord };
}

const command = (name: string, options?: { name: string; value: string }[], user = OWNER): Partial<Interaction> => ({ type: InteractionType.Command, member: { user: { id: user } }, data: { name, options } });

describe("discord interactions endpoint", () => {
  test("answers PING when the signature is valid", async () => {
    const { post } = setup();
    const res = await post({ type: InteractionType.Ping });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  test("rejects missing, invalid and tampered signatures with 401", async () => {
    const { post } = setup();
    expect((await post({ type: 1 }, {})).status).toBe(401);
    expect((await post({ type: 1 }, { "x-signature-ed25519": "00".repeat(64), "x-signature-timestamp": "1" })).status).toBe(401);
    const signed = await sign(JSON.stringify({ id: "i1", token: "tok", application_id: "123456789012345678", type: 1 }));
    expect((await post({ type: 2 }, signed)).status).toBe(401);
    expect((await post({ type: 1 }, { ...(await sign("x")), "x-signature-timestamp": "1700000001" })).status).toBe(401);
  });

  test("anyone but the owner gets an ephemeral refusal and nothing runs", async () => {
    const { post, calls } = setup();
    const res = (await (await post(command("skip", undefined, "123"))).json()) as object;
    expect(res).toEqual({ type: 4, data: { content: "Only the owner can use this bot.", flags: 64, allowed_mentions: { parse: [] } } });
    const button = (await (await post({ type: InteractionType.Component, user: { id: "123" }, data: { custom_id: `queue:${uri("a")}` } })).json()) as { data: { flags: number } };
    expect(button.data.flags).toBe(64);
    expect(calls).toHaveLength(0);
  });
});

describe("discord commands", () => {
  test("/stats and /top answer from the database with sentence-case text and units", async () => {
    const { db, post } = setup();
    const now = Date.now();
    seed(db, [track("a", "Song *A*", "Artist @everyone", "Album")], [play(new Date(now - 3_600_000).toISOString(), uri("a"), 3_600_000)]);
    const stats = (await (await post(command("stats", [{ name: "range", value: "week" }]))).json()) as { type: number; data: { embeds: { title: string; fields: { name: string; value: string }[] }[] } };
    expect(stats.type).toBe(4);
    expect(stats.data.embeds[0]!.title).toBe("Last 7 days");
    expect(stats.data.embeds[0]!.fields.find((f) => f.name === "Hours")!.value).toBe("1 h");
    const top = (await (await post(command("top", [{ name: "kind", value: "songs" }]))).json()) as { data: { embeds: { description: string }[] } };
    expect(top.data.embeds[0]!.description).toBe("1. Song \\*A\\* · Artist @​everyone · 1 h");
  });

  test("/forgotten lists favourites with a Queue button each; the button queues on Spotify", async () => {
    const { db, post, discord, calls } = setup((call) => (call.url.includes("/me/player/queue") ? noContent() : undefined));
    const old = Date.now() - 200 * 86_400_000;
    seed(db, [track("f", "Old favourite", "Artist", "Album", { albumArtUrl: "https://img/f" })], Array.from({ length: 12 }, (_, i) => play(new Date(old - i * 86_400_000).toISOString(), uri("f"), 200_000)));
    const res = (await (await post(command("forgotten"))).json()) as { data: { embeds: { title: string; thumbnail: { url: string } }[]; components: { components: { custom_id: string; label: string }[] }[] } };
    expect(res.data.embeds[0]).toMatchObject({ title: "Old favourite", thumbnail: { url: "https://img/f" } });
    expect(res.data.components[0]!.components[0]).toMatchObject({ custom_id: `queue:${uri("f")}`, label: "Queue Old favourite" });

    const pressed = (await (await post({ type: InteractionType.Component, member: { user: { id: OWNER } }, data: { custom_id: `queue:${uri("f")}` } })).json()) as object;
    expect(pressed).toEqual({ type: 5, data: { flags: 64 } });
    await discord.interactions.whenIdle();
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(uri("f"))}`],
      ["PATCH", "https://discord.com/api/v10/webhooks/123456789012345678/tok/messages/@original"],
    ]);
    expect(calls[1]!.body).toEqual({ content: "Queued Old favourite.", flags: 64, allowed_mentions: { parse: [] } });
  });

  test("/play searches history first, plays it, and follows up after deferring", async () => {
    const { db, post, discord, calls } = setup((call) => (call.url.includes("/me/player/play") ? noContent() : undefined));
    seed(db, [track("h", "Hometown", "Band", "Album")], [play("2026-01-01T10:00:00Z", uri("h"), 200_000)]);
    expect(await (await post(command("play", [{ name: "query", value: "hometown" }]))).json()).toEqual({ type: 5 });
    await discord.interactions.whenIdle();
    expect(calls[0]).toMatchObject({ method: "PUT", body: { uris: [uri("h")] } });
    expect(calls[1]!.body).toMatchObject({ embeds: [{ author: { name: "Playing" }, title: "Hometown" }] });
  });

  test("/skip without an active device follows up with a plain error", async () => {
    const { post, discord, calls } = setup((call) =>
      call.url.includes("/me/player/next") ? jsonResponse({ error: { status: 404, message: "Player command failed: No active device found", reason: "NO_ACTIVE_DEVICE" } }, 404) : undefined,
    );
    await post(command("skip"));
    await discord.interactions.whenIdle();
    expect(calls[1]!.body).toEqual({ content: "No active Spotify device. Start playback on a device first.", flags: 64, allowed_mentions: { parse: [] } });
  });

  test("/now uses the watcher cache and shows artwork", async () => {
    const item = { id: "n", uri: uri("n"), name: "Now song", duration_ms: 180_000, artists: [{ id: "x", name: "Artist", uri: "spotify:artist:x" }], album: { id: "al", name: "Album", images: [{ url: "https://img/n", width: 640, height: 640 }] } };
    const state = { device: { id: "d", is_active: true, is_restricted: false, name: "iPhone", type: "Smartphone", volume_percent: 1 }, shuffle_state: false, repeat_state: "off", timestamp: 0, progress_ms: 61_000, is_playing: true, currently_playing_type: "track", item, context: null };
    const { post, discord, calls } = setup((call) => (call.url.endsWith("/me/player") ? jsonResponse(state) : undefined));
    await post(command("now"));
    await discord.interactions.whenIdle();
    await post(command("now"));
    await discord.interactions.whenIdle();
    expect(calls.filter((c) => c.url.includes("spotify")).length).toBe(1);
    expect(calls.at(-1)!.body).toMatchObject({ embeds: [{ author: { name: "Playing on iPhone" }, title: "Now song", image: { url: "https://img/n" } }] });
  });

  test("/releases and /cleanup read stored data only", async () => {
    const { post, calls } = setup();
    expect(((await (await post(command("releases"))).json()) as { data: { content: string } }).data.content).toBe("No new releases.");
    const cleanup = (await (await post(command("cleanup"))).json()) as { data: { embeds: { title: string }[]; components: { components: { style: number; url: string }[] }[] } };
    expect(cleanup.data.embeds[0]!.title).toBe("No cleanup proposals");
    expect(cleanup.data.components[0]!.components[0]).toMatchObject({ style: 5, url: "http://localhost:8888" });
    expect(calls).toHaveLength(0);
  });

  test("the registry rejects duplicate commands so other modules add their own", () => {
    const { discord } = setup();
    expect(discord.registry.definitions().map((d) => d.name)).toEqual(["now", "play", "queue", "skip", "stats", "top", "onthisday", "forgotten", "releases", "cleanup", "set", "picks", "ask"]);
    expect(() => discord.registry.addCommand({ definition: { name: "picks", description: "x" }, defer: false, handle: () => ({}) })).toThrow();
    discord.registry.addCommand({ definition: { name: "notes", description: "Notes" }, defer: false, handle: () => ({ content: "ok" }) });
    expect(discord.registry.command("notes")).toBeDefined();
  });

  test("names are escaped and truncated", () => {
    expect(plain("a*b_c")).toBe("a\\*b\\_c");
    expect(plain("# big\n- item 2026-01-01")).toBe("\\# big\n\\- item 2026-01-01");
    expect(plain("x".repeat(300)).length).toBe(256);
  });
});

describe("discord error copy", () => {
  test("a Spotify pause shows the local time it ends", () => {
    expect(errorMessage(new SpotifyBlockedError("quota_exceeded", Date.parse("2026-11-14T10:30:00Z")), "Asia/Kuwait")).toBe("Spotify calls are paused until 13:30.");
  });
});
