import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { llmCalls, picks } from "../src/db/schema";
import type { LlmTransport } from "../src/llm/client";
import { monthOf } from "../src/llm/ledger";
import { testApp, TZ, uri } from "./helpers";
import { message, scripted, seedLibrary, text } from "./llmFakes";

const ADMIN = { authorization: "Bearer admin-token-admin-token-123" };

function signedIn(transport: LlmTransport | null = null, env: Record<string, string> = {}) {
  const app = testApp(env, transport);
  const cookie = `encore_session=${createSession(app.db)}`;
  const get = (path: string) => app.request(path, { headers: { cookie } });
  const post = (path: string, json: unknown, headers: Record<string, string> = {}) => app.request(path, { json, headers: { cookie, ...headers } });
  return { ...app, cookie, get, post };
}

function spend(db: ReturnType<typeof testApp>["db"], usd: number) {
  db.insert(llmCalls)
    .values({ ts: Date.now(), month: monthOf(Date.now(), TZ), feature: "ask", requestedModel: "claude-opus-5-5", model: "claude-opus-5-5", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, usd, stopReason: "end_turn", durationMs: 1 })
    .run();
}

const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string; details?: unknown } }).error;

describe("admin token scope", () => {
  test("accepted for POST /api/import", async () => {
    const { app } = testApp();
    const form = new FormData();
    form.append("files", new File(["[]"], "Streaming_History_Audio_2026.json"));
    const res = await app.request("/api/import", { method: "POST", body: form, headers: ADMIN });
    expect(res.status).toBe(200);
  });

  test("rejected on every other route, including other methods on /api/import", async () => {
    const { request } = testApp();
    const gets = ["/api/import", "/api/status", "/api/history", "/api/stats/overview", "/api/sets", "/api/picks", "/api/blocks", "/api/ask/threads", "/api/digests", "/api/llm/spend", "/api/notes?songKey=x"];
    for (const path of gets) expect((await request(path, { headers: ADMIN })).status).toBe(401);
    const posts: [string, unknown][] = [
      ["/api/sets", { request: "x" }],
      ["/api/ask", { question: "x" }],
      ["/api/picks/generate", {}],
      ["/api/notes", { songKey: "x" }],
      ["/api/digests/generate", { kind: "weekly" }],
      ["/api/import/extra", {}],
    ];
    for (const [path, json] of posts) expect((await request(path, { json, headers: ADMIN })).status).toBe(401);
    expect((await request("/api/import", { method: "DELETE", headers: ADMIN })).status).toBe(401);
  });
});

describe("status and spend", () => {
  test("status carries the LLM block and spend detail lists calls", async () => {
    const { get, db } = signedIn(scripted().transport, { MONTHLY_BUDGET_USD: "20" });
    spend(db, 1.25);
    const status = (await (await get("/api/status")).json()) as { llm: Record<string, unknown> };
    expect(status.llm).toMatchObject({
      configured: true,
      model: "claude-opus-5-5",
      month: monthOf(Date.now(), TZ),
      spentUsd: 1.25,
      capUsd: 20,
      remainingUsd: 18.75,
      exhausted: false,
      byFeature: [{ feature: "ask", calls: 1, usd: 1.25 }],
      jobs: { picks: expect.anything(), digest: expect.anything(), outcomes: expect.anything() },
    });
    const detail = (await (await get("/api/llm/spend")).json()) as Record<string, unknown>;
    expect(detail).toMatchObject({ model: "claude-opus-5-5", webSearchPerRequest: 0.01, budget: { spentUsd: 1.25 } });
    expect((detail.pricesPerMTok as Record<string, unknown>)["claude-opus-5-5"]).toEqual({ input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 });
  });
});

describe("LLM errors over HTTP", () => {
  test("no API key: 503 llm_not_configured, JSON and SSE", async () => {
    const { post } = signedIn(null);
    const res = await post("/api/ask", { question: "x" });
    expect(res.status).toBe(503);
    expect((await errorCode(res)).code).toBe("llm_not_configured");
    expect((await post("/api/sets", { request: "x" }, { accept: "text/event-stream" })).status).toBe(503);
  });

  test("budget spent: 402 with month, spend and cap, before any stream opens", async () => {
    const fake = scripted();
    const { post, db } = signedIn(fake.transport, { MONTHLY_BUDGET_USD: "3" });
    spend(db, 3);
    for (const [path, json] of [
      ["/api/ask", { question: "x" }],
      ["/api/sets", { request: "x" }],
      ["/api/picks/generate", {}],
      ["/api/digests/generate", { kind: "weekly" }],
    ] as const) {
      const res = await post(path, json, path === "/api/ask" ? { accept: "text/event-stream" } : {});
      expect(res.status).toBe(402);
      expect(await errorCode(res)).toMatchObject({ code: "llm_budget_exceeded", details: { month: monthOf(Date.now(), TZ), spentUsd: 3, capUsd: 3 } });
    }
    expect(fake.requests).toHaveLength(0);
  });
});

describe("streaming", () => {
  test("SSE sends text deltas and a done event with the JSON body", async () => {
    const { post, db } = signedIn(scripted(message([text("You played Woods 20 times.")])).transport);
    seedLibrary(db);
    const res = await post("/api/ask", { question: "top song?" }, { accept: "text/event-stream" });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = (await res.text())
      .trim()
      .split("\n\n")
      .map((chunk) => {
        const lines = Object.fromEntries(chunk.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
        return { event: lines.event, data: JSON.parse(lines.data!) };
      });
    expect(events).toEqual([
      { event: "text", data: { delta: "You played Woods 20 times." } },
      { event: "done", data: { threadId: 1, answer: "You played Woods 20 times.", toolCalls: [] } },
    ]);
  });
});

describe("picks and blocks over HTTP", () => {
  test("marking a pick never adds a song block; deleting the block lifts it", async () => {
    const { request, cookie, db, get } = signedIn();
    const pick = db
      .insert(picks)
      .values({ week: "2026-01-05", position: 1, uri: uri("x1"), songKey: "song|artist", name: "Song", artist: "Artist", album: null, releaseDate: null, reason: "r", distance: "near", state: "new", stateAt: 0, createdAt: 0 })
      .returning()
      .get();
    const patch = (state: string) => request(`/api/picks/${pick.id}`, { method: "PATCH", body: JSON.stringify({ state }), headers: { cookie, "content-type": "application/json" } });
    expect((await patch("maybe")).status).toBe(400);
    expect((await patch("never")).status).toBe(200);
    const blocks = ((await (await get("/api/blocks")).json()) as { items: { id: number; kind: string; key: string }[] }).items;
    expect(blocks).toMatchObject([{ kind: "song", key: "song|artist" }]);
    expect((await request(`/api/blocks/${blocks[0]!.id}`, { method: "DELETE", headers: { cookie } })).status).toBe(200);
    expect(((await (await get("/api/blocks")).json()) as { items: unknown[] }).items).toEqual([]);
    expect((await request("/api/picks/999", { method: "PATCH", body: JSON.stringify({ state: "saved" }), headers: { cookie, "content-type": "application/json" } })).status).toBe(404);
  });

  test("unknown sets, threads and digests are 404", async () => {
    const { get } = signedIn();
    for (const path of ["/api/sets/9", "/api/ask/threads/9", "/api/digests/9", "/api/notes?songKey=nope"]) expect((await get(path)).status).toBe(404);
  });
});
