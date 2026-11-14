import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { seed, testApp, track, uri } from "./helpers";

const ADMIN = "admin-token-admin-token-123";

describe("catalog seed", () => {
  test("fills missing details and artist links, keeps existing values, skips unknown tracks, and needs the admin token", async () => {
    const { app, db } = testApp({ ADMIN_TOKEN: ADMIN });
    seed(db, [track("a", "A", "X", "Al"), track("b", "B", "X", "Al")], []);
    db.run(sql`update tracks set album_art_url = 'https://kept/art', enriched_at = 5 where uri = ${uri("b")}`);
    const body = {
      artists: [{ id: "ar1", name: "X", imageUrl: "https://img/x", fetchedAt: 9 }],
      tracks: [
        { uri: uri("a"), durationMs: 200000, releaseDate: "2020-01-01", albumArtUrl: "https://new/a", enrichedAt: 7, artistIds: ["ar1"] },
        { uri: uri("b"), durationMs: 100000, releaseDate: null, albumArtUrl: "https://new/b", enrichedAt: 7, artistIds: ["ar1"] },
        { uri: uri("zz"), durationMs: 1, releaseDate: null, albumArtUrl: null, enrichedAt: 7, artistIds: [] },
      ],
    };
    const post = (headers: Record<string, string>) => app.request("/api/import/catalog", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
    expect((await post({})).status).toBe(401);
    const res = await post({ authorization: `Bearer ${ADMIN}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ artists: 1, tracks: 2, unknownTracks: 1 });
    expect(db.all(sql`select uri, duration_ms, album_art_url, enriched_at from tracks order by uri`)).toEqual([
      { uri: uri("a"), duration_ms: 200000, album_art_url: "https://new/a", enriched_at: 7 },
      { uri: uri("b"), duration_ms: 100000, album_art_url: "https://kept/art", enriched_at: 5 },
    ]);
    expect(db.all(sql`select track_uri, artist_id from track_artists`)).toEqual([{ track_uri: uri("a"), artist_id: "ar1" }]);
    expect(db.all(sql`select id, image_url, fetched_at from artists`)).toEqual([{ id: "ar1", image_url: "https://img/x", fetched_at: 9 }]);
  });
});
