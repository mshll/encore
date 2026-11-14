import { describe, expect, test } from "bun:test";
import { play, seed, testApp, track, uri } from "./helpers";

const TOKEN = "mcp-token-mcp-token-mcp-token";
const headers = (token?: string) => ({
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});
const rpc = (method: string, params: unknown = {}, id = 1) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const init = rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });

async function body(res: Response) {
  const text = await res.text();
  const data = text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data: "))!.slice(6);
  return JSON.parse(data) as { result?: { tools?: { name: string }[]; content?: { text: string }[] }; error?: unknown };
}

describe("mcp endpoint", () => {
  test("is disabled without MCP_TOKEN", async () => {
    const { app } = testApp();
    expect((await app.request("/mcp", { method: "POST", body: init, headers: headers(TOKEN) })).status).toBe(404);
  });

  test("rejects a missing or wrong bearer token, and the session cookie does not count", async () => {
    const { app } = testApp({ MCP_TOKEN: TOKEN });
    expect((await app.request("/mcp", { method: "POST", body: init, headers: headers() })).status).toBe(401);
    expect((await app.request("/mcp", { method: "POST", body: init, headers: headers("wrong-token-wrong-token-wrong") })).status).toBe(401);
  });

  test("lists read tools and the two playback actions, and answers a tool call", async () => {
    const { app, db } = testApp({ MCP_TOKEN: TOKEN });
    seed(db, [track("a", "Song A", "Artist", "Album")], [play("2026-01-01T10:00:00Z", uri("a"), 200_000)]);
    expect((await app.request("/mcp", { method: "POST", body: init, headers: headers(TOKEN) })).status).toBe(200);
    const list = await body(await app.request("/mcp", { method: "POST", body: rpc("tools/list", {}, 2), headers: { ...headers(TOKEN), "mcp-protocol-version": "2025-06-18" } }));
    expect(list.result!.tools!.map((t) => t.name).sort()).toEqual(["add_to_queue", "forgotten", "history", "lookup", "now_playing", "on_this_day", "overview", "play", "releases", "top"]);
    const call = await body(
      await app.request("/mcp", { method: "POST", body: rpc("tools/call", { name: "overview", arguments: {} }, 3), headers: { ...headers(TOKEN), "mcp-protocol-version": "2025-06-18" } }),
    );
    expect(JSON.parse(call.result!.content![0]!.text)).toMatchObject({ plays: 1, topTrack: { name: "Song A" } });
  });
});
