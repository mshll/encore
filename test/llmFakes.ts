import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../src/db/client";
import { spotifyAuth } from "../src/db/schema";
import { Llm, type LlmMessage, type LlmTransport, type StreamParams } from "../src/llm/client";
import type { FeatureContext } from "../src/llm/context";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { upsertTags } from "../src/tags/service";
import { play, seed, testConfig, testDb, track, uri } from "./helpers";

type Block = Anthropic.Beta.BetaContentBlock;

let ids = 0;

export function usage(partial: Partial<Anthropic.Beta.BetaUsage> = {}): Anthropic.Beta.BetaUsage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    fallback_credit: null,
    inference_geo: null,
    input_tokens: 1000,
    iterations: null,
    output_tokens: 100,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: "standard",
    speed: "standard",
    ...partial,
  };
}

export function message(content: Block[], stop: Anthropic.Beta.BetaStopReason = "end_turn", extra: Partial<LlmMessage> = {}): LlmMessage {
  return {
    id: `msg_${++ids}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    stop_details: null,
    usage: usage(),
    container: null,
    context_management: null,
    ...extra,
  } as LlmMessage;
}

export const text = (t: string): Block => ({ type: "text", text: t, citations: null }) as Block;

export const toolUse = (name: string, input: unknown): Block => ({ type: "tool_use", id: `toolu_${++ids}`, name, input }) as Block;

export const toolCall = (name: string, input: unknown) => message([toolUse(name, input)], "tool_use");

/** A server-side web search and its results, as they appear in an assistant message. */
export function webSearch(query: string, results: { url: string; title: string }[]): Block[] {
  const id = `srvtoolu_${++ids}`;
  return [
    { type: "server_tool_use", id, name: "web_search", input: { query } },
    { type: "web_search_tool_result", tool_use_id: id, content: results.map((r) => ({ type: "web_search_result", url: r.url, title: r.title, encrypted_content: "", page_age: null })) },
  ] as unknown as Block[];
}

/** Replays scripted responses in order and records every request it received. */
export function scripted(...responses: (LlmMessage | ((params: StreamParams) => LlmMessage))[]) {
  const requests: StreamParams[] = [];
  const transport: LlmTransport = async (params, onText) => {
    requests.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error("scripted transport ran out of responses");
    const msg = typeof next === "function" ? next(params) : next;
    for (const b of msg.content) if (b.type === "text") onText(b.text);
    return msg;
  };
  return { transport, requests, remaining: () => responses.length };
}

/** Tool results the model received in the last user message of a request. */
export function toolResults(params: StreamParams) {
  const last = params.messages[params.messages.length - 1]!;
  return (last.content as Anthropic.Beta.BetaToolResultBlockParam[]).map((r) => ({ isError: r.is_error ?? false, value: JSON.parse(r.content as string) as Record<string, unknown> }));
}

export const SONGS = {
  woods: { id: "w1", name: "Woods", artist: "Mac Miller", album: "Circles" },
  surf: { id: "s1", name: "Surf", artist: "Mac Miller", album: "Circles" },
  nights: { id: "n1", name: "Nights", artist: "Frank Ocean", album: "Blonde" },
  dna: { id: "d1", name: "DNA.", artist: "Kendrick Lamar", album: "DAMN." },
};

/** A small library: Woods is finished at night and skipped in the morning; Surf is a keeper; Nights is skipped everywhere. */
export function seedLibrary(db: Db) {
  const tracks = Object.values(SONGS).map((s) => track(s.id, s.name, s.artist, s.album, { durationMs: 200_000 }));
  const plays = [];
  for (let i = 0; i < 10; i++) {
    const d = String(i + 1).padStart(2, "0");
    plays.push(play(`2026-01-${d}T20:00:00Z`, uri("w1"), 200_000, { skipped: false }));
    plays.push(play(`2026-01-${d}T05:00:00Z`, uri("w1"), 10_000, { skipped: true }));
    plays.push(play(`2026-01-${d}T12:00:00Z`, uri("s1"), 200_000, { skipped: false }));
    plays.push(play(`2026-01-${d}T13:00:00Z`, uri("n1"), 5_000, { skipped: true }));
  }
  plays.push(play("2026-01-20T10:00:00Z", uri("d1"), 200_000));
  seed(db, tracks, plays);
  upsertTags(db, [
    { uri: uri("w1"), genres: ["hip-hop"], moods: ["introspective"], energy: 2, valence: 2, language: "en", model: "test", confidence: "high" },
    { uri: uri("s1"), genres: ["hip-hop", "soul"], moods: ["chill"], energy: 2, valence: 4, language: "en", model: "test", confidence: "high" },
    { uri: uri("n1"), genres: ["rnb"], moods: ["dreamy"], energy: 3, valence: 2, language: "en", model: "test", confidence: "high" },
  ]);
}

export type FakeSpotifyTrack = { id: string; name: string; artists: string[]; album: string };

export function spotifyTrack(t: FakeSpotifyTrack) {
  return {
    id: t.id.padStart(22, "0"),
    uri: uri(t.id),
    name: t.name,
    duration_ms: 210_000,
    artists: t.artists.map((a) => ({ id: a, name: a, uri: `spotify:artist:${a}` })),
    album: { id: "alb", name: t.album, release_date: "2020-01-01", images: [{ url: `https://img.test/${t.id}.jpg`, width: 640, height: 640 }] },
  };
}

/** Fake Spotify Web API: search answers from `catalog`; writes are recorded. */
export function fakeSpotifyFetch(catalog: FakeSpotifyTrack[]) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/v1/search") {
      const q = url.searchParams.get("q")!.toLowerCase();
      const items = catalog.filter((t) => q.includes(t.name.toLowerCase()) && t.artists.some((a) => q.includes(a.toLowerCase()))).map(spotifyTrack);
      return json({ tracks: { items } });
    }
    if (url.pathname === "/v1/me/playlists" && method === "POST") return json({ id: "pl1", external_urls: { spotify: "https://open.spotify.com/playlist/pl1" } }, 201);
    if (url.pathname.endsWith("/items") && ["PUT", "POST", "DELETE"].includes(method)) return json({ snapshot_id: "snap" });
    if (url.pathname.startsWith("/v1/me/player")) return new Response(null, { status: 204 });
    if (url.pathname === "/v1/me/library" && method === "PUT") return new Response(null, { status: 200 });
    if (url.pathname.startsWith("/v1/playlists/") && method === "PUT") return new Response(null, { status: 200 });
    if (url.pathname === "/v1/me/library/contains") return json(url.searchParams.get("uris")!.split(",").map((u) => u.endsWith("1")));
    return json({ error: { message: "not found" } }, 404);
  }) as typeof fetch;
  return { fetchFn, calls };
}

/** A clock that moves forward one second per reading, so rate spacing never sleeps in tests. */
export function clock(start = "2026-02-01T12:00:00Z") {
  let t = Date.parse(start);
  const now = () => (t += 1000);
  return { now, set: (iso: string) => (t = Date.parse(iso)) };
}

export function featureCtx(transport: LlmTransport | null, catalog: FakeSpotifyTrack[] = [], env: Record<string, string> = {}, start?: string) {
  const db = testDb();
  const config = testConfig(env);
  const time = clock(start);
  db.insert(spotifyAuth).values({ id: 1, accessToken: "tok", refreshToken: "ref", expiresAt: 9e15, scope: "", clientId: "test-client", updatedAt: 0 }).run();
  const auth = new SpotifyAuth(db, config, fetch, time.now);
  const fake = fakeSpotifyFetch(catalog);
  const spotify = new SpotifyClient(db, auth, config, fake.fetchFn, time.now);
  const llm = new Llm(db, config, transport, time.now);
  const ctx: FeatureContext = { db, config, llm, spotify, now: time.now };
  return { ctx, db, spotifyCalls: fake.calls, auth, time };
}
