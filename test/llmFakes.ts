import type { Db } from "../src/db/client";
import { spotifyAuth } from "../src/db/schema";
import { Llm } from "../src/llm/client";
import type { FeatureContext } from "../src/llm/context";
import type { AssistantMessage, LlmReply, LlmRequest, LlmTransport, SourcePart, StopReason, TextPart, ToolCallPart, ToolResultPart, Usage } from "../src/llm/types";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { upsertTags } from "../src/tags/service";
import { play, seed, testConfig, testDb, track, uri, testSettings } from "./helpers";

type Part = AssistantMessage["content"][number];

let ids = 0;

export function usage(partial: Partial<Usage> = {}): Usage {
  return { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, ...partial };
}

/** A model reply. The stop reason defaults to tool_calls when the reply calls a tool, else end. */
export function message(content: Part[], stop?: StopReason, extra: Partial<LlmReply> = {}): LlmReply {
  return { content, stopReason: stop ?? (content.some((p) => p.type === "tool_call") ? "tool_calls" : "end"), usage: usage(), model: "claude-opus-5-5", ...extra };
}

export const text = (t: string): TextPart => ({ type: "text", text: t });

export const toolUse = (name: string, input: unknown): ToolCallPart => ({ type: "tool_call", id: `call_${++ids}`, name, input });

export const toolCall = (name: string, input: unknown) => message([toolUse(name, input)]);

/** The pages a provider's web search returned, as they appear in a reply. */
export function webSearch(_query: string, results: { url: string; title: string }[]): SourcePart[] {
  return results.map((r) => ({ type: "source", url: r.url, title: r.title }));
}

/** Replays scripted replies in order and records every request it received. */
export function scripted(...responses: (LlmReply | ((request: LlmRequest) => LlmReply))[]) {
  const requests: LlmRequest[] = [];
  const transport: LlmTransport = async (request, onText) => {
    requests.push(structuredClone(request));
    const next = responses.shift();
    if (!next) throw new Error("scripted transport ran out of responses");
    const reply = typeof next === "function" ? next(request) : next;
    for (const p of reply.content) if (p.type === "text") onText(p.text);
    return reply;
  };
  return { transport, requests, remaining: () => responses.length };
}

/** Tool results the model received in the last user message of a request. */
export function toolResults(request: LlmRequest) {
  const last = request.messages[request.messages.length - 1]!;
  return (last.content as ToolResultPart[]).map((r) => ({ isError: r.isError ?? false, value: JSON.parse(r.content) as Record<string, unknown> }));
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
    const isJson = new Headers(init?.headers).get("content-type") === "application/json";
    const body = init?.body ? (isJson ? JSON.parse(String(init.body)) : String(init.body)) : undefined;
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
  const settings = testSettings(db, config);
  const time = clock(start);
  db.insert(spotifyAuth).values({ id: 1, accessToken: "tok", refreshToken: "ref", expiresAt: 9e15, scope: "", clientId: "test-client", updatedAt: 0 }).run();
  const auth = new SpotifyAuth(db, config, settings, fetch, time.now);
  const fake = fakeSpotifyFetch(catalog);
  const spotify = new SpotifyClient(db, auth, settings, fake.fetchFn, time.now);
  const llm = new Llm(db, settings, () => transport, time.now);
  const ctx: FeatureContext = { db, config, settings, llm, spotify, now: time.now };
  return { ctx, db, spotifyCalls: fake.calls, fetchFn: fake.fetchFn, auth, time };
}
