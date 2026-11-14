import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { seed, testApp, track, uri } from "./helpers";

function signedIn(env: Record<string, string> = {}) {
  const app = testApp(env);
  const cookie = `encore_session=${createSession(app.db)}`;
  return { ...app, get: (path: string) => app.request(path, { headers: { cookie } }) };
}

describe("track lookup", () => {
  test("returns identities for known URIs and leaves unknown ones out", async () => {
    const { db, get } = signedIn();
    seed(db, [track("a", "Song A", "Artist", "Album", { albumArtUrl: "https://img/a" }), track("b", "Song B", "Artist", null)], []);
    const res = await get(`/api/tracks?uri=${uri("a")}&uri=${uri("b")}&uri=${uri("zz")}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { uri: string; name: string; albumArtUrl: string | null }[] };
    expect(body.items.map((t) => [t.uri, t.name, t.albumArtUrl]).sort()).toEqual([
      [uri("a"), "Song A", "https://img/a"],
      [uri("b"), "Song B", null],
    ]);
  });

  test("rejects a missing or malformed URI", async () => {
    const { get } = signedIn();
    expect((await get("/api/tracks")).status).toBe(400);
    expect((await get("/api/tracks?uri=spotify:album:x")).status).toBe(400);
  });
});

describe("status integrations", () => {
  test("reports whether Discord and MCP are configured", async () => {
    const off = (await (await signedIn().get("/api/status")).json()) as { integrations: unknown };
    expect(off.integrations).toEqual({ discord: false, mcp: false });
    const on = (await (await signedIn({ MCP_TOKEN: "mcp-token-mcp-token-mcp-token" }).get("/api/status")).json()) as { integrations: unknown };
    expect(on.integrations).toEqual({ discord: false, mcp: true });
  });

  test("reports when picks and digests are scheduled", async () => {
    const status = (await (await signedIn({ PICKS_WEEKDAY: "1", PICKS_HOUR: "8" }).get("/api/status")).json()) as { llm: { schedule: unknown } };
    expect(status.llm.schedule).toEqual({ enabled: expect.any(Boolean), picks: { weekday: 1, hour: 8 }, digest: { weekday: 5, hour: 9 } });
  });
});
