import { describe, expect, test } from "bun:test";
import { createSession } from "../src/auth/sessions";
import { setItems, sets } from "../src/db/schema";
import { createThread } from "../src/llm/threads";
import { coverArt, coverKey } from "../src/sets/cover";
import { testApp } from "./helpers";

describe("cover key", () => {
  const source = { title: "Late drive", style: "field" as const, art: ["https://i.scdn.co/image/a", "https://i.scdn.co/image/b"] };

  test("is the same for the same source", () => {
    expect(coverKey(source)).toBe(coverKey({ ...source, art: [...source.art] }));
  });

  test("changes with the title, the style or the art order", () => {
    const keys = [source, { ...source, title: "Late drive 2" }, { ...source, style: "rings" as const }, { ...source, art: [...source.art].reverse() }].map(coverKey);

    expect(new Set(keys).size).toBe(4);
  });

  test("art is distinct, on the image CDN, in set order, at most 8", () => {
    const cdn = (id: string) => `https://i.scdn.co/image/${id}`;
    const items = [cdn("a"), null, "https://img.test/x.jpg", cdn("b"), cdn("a"), ...Array.from({ length: 10 }, (_, i) => cdn(`c${i}`))].map((albumArtUrl) => ({ albumArtUrl }));

    expect(coverArt(items)).toEqual([cdn("a"), cdn("b"), ...[0, 1, 2, 3, 4, 5].map((i) => cdn(`c${i}`))]);
  });
});

describe("GET /api/sets/:id/cover", () => {
  function withSet(items: number) {
    const app = testApp();
    const cookie = `encore_session=${createSession(app.db)}`;
    const threadId = createThread(app.db, "sets", [], [], 0);
    const setId = app.db.insert(sets).values({ threadId, request: "r", title: "Late drive", description: "", version: 1, createdAt: 0, updatedAt: 0 }).returning({ id: sets.id }).get().id;
    for (let p = 1; p <= items; p++) app.db.insert(setItems).values({ setId, position: p, kind: "new", songKey: `s${p}`, uri: `spotify:track:${p}`, name: `S${p}`, artist: "A", reason: "r" }).run();
    const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers: { cookie, ...headers } });
    return { get, setId };
  }

  test("serves the JPEG, cached for good at its versioned URL, and answers 304 when unchanged", async () => {
    const { get, setId } = withSet(2);
    const listed = (await (await get("/api/sets")).json()) as { items: { coverUrl: string }[] };

    const res = await get(listed.items[0]!.coverUrl);
    const again = await get(listed.items[0]!.coverUrl, { "if-none-match": res.headers.get("etag")! });

    expect(listed.items[0]!.coverUrl).toStartWith(`/api/sets/${setId}/cover?v=`);
    expect([res.status, res.headers.get("content-type"), res.headers.get("cache-control")]).toEqual([200, "image/jpeg", "private, max-age=31536000, immutable"]);
    expect(again.status).toBe(304);
  });

  test("a set without tracks has no cover", async () => {
    const { get, setId } = withSet(0);

    expect((await get(`/api/sets/${setId}/cover`)).status).toBe(404);
  });
});
