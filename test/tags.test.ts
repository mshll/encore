import { describe, expect, test } from "bun:test";
import { pendingTracks, tagCoverage } from "../src/tags/service";
import { play, seed, testApp, track, uri } from "./helpers";

const ADMIN = { authorization: "Bearer admin-token-admin-token-123" };

const tag = (overrides: Record<string, unknown> = {}) => ({
  uri: uri("a1"),
  genres: ["hip-hop", "rnb"],
  subgenre: "jazz rap",
  moods: ["chill"],
  energy: 3,
  valence: 4,
  language: "en",
  model: "test-model",
  confidence: "high",
  ...overrides,
});

function setup() {
  const app = testApp();
  seed(
    app.db,
    [track("a1", "Song A", "Artist X", "Album 1"), track("a2", "Song A - Remastered 2020", "Artist X", "Deluxe"), track("c", "Song C", "Artist Y", "Album 2")],
    [
      play("2026-01-05T10:00:00Z", uri("a1"), 200000),
      play("2026-01-05T11:00:00Z", uri("a1"), 200000),
      play("2026-01-05T12:00:00Z", uri("a2"), 200000),
      play("2026-01-05T13:00:00Z", uri("c"), 200000),
    ],
  );
  const post = (body: unknown) => app.request("/api/tags", { json: body, headers: ADMIN });
  return { ...app, post };
}

describe("tag validation", () => {
  test.each([
    ["unknown genre", { genres: ["polka"] }],
    ["no genres", { genres: [] }],
    ["four moods", { moods: ["chill", "calm", "sad", "dark"] }],
    ["duplicate moods", { moods: ["chill", "chill"] }],
    ["energy out of range", { energy: 6 }],
    ["fractional valence", { valence: 2.5 }],
    ["bad language", { language: "english" }],
    ["unknown language code", { language: "qq" }],
    ["bad confidence", { confidence: "certain" }],
    ["extra field", { popularity: 50 }],
    ["bad uri", { uri: "spotify:album:123" }],
  ])("rejects %s", async (_, overrides) => {
    const { post } = setup();
    const res = await post({ tags: [tag(overrides)] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_request");
  });

  test("rejects unknown tracks and writes nothing", async () => {
    const { post, db } = setup();
    const res = await post({ tags: [tag(), tag({ uri: uri("zz") })] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { details: { uris: string[] } } }).error.details.uris).toEqual([uri("zz")]);
    expect(tagCoverage(db).tagged).toBe(0);
  });

  test("accepts instrumental and upserts", async () => {
    const { post, db } = setup();
    expect((await post({ tags: [tag({ language: "instrumental" })] })).status).toBe(200);
    expect(await (await post({ tags: [tag({ energy: 5 })] })).json()).toEqual({ upserted: 1 });
    expect(tagCoverage(db)).toEqual({ songs: 2, tagged: 1, coverage: 0.5 });
  });
});

describe("pending tracks", () => {
  test("lists one representative per song, most listened first, and drops songs once tagged", async () => {
    const { post, db } = setup();
    const before = pendingTracks(db, 10, 0);
    expect(before.total).toBe(2);
    expect(before.items[0]).toEqual({ uri: uri("a1"), name: "Song A", artist: "Artist X", album: "Album 1", listens: 3 });
    await post({ tags: [tag({ uri: uri("a2") })] });
    expect(pendingTracks(db, 10, 0).items.map((t) => t.uri)).toEqual([uri("c")]);
  });
});
