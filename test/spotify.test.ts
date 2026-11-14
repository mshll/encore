import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { spotifyAuth as spotifyAuthTable } from "../src/db/schema";
import { enrichTracks } from "../src/ingest/live/enrich";
import { pollRecentlyPlayed } from "../src/ingest/live/poller";
import { importExport } from "../src/ingest/export/import";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { SpotifyBlockedError } from "../src/spotify/errors";
import type { SpotifyTrack } from "../src/spotify/types";
import { jsonResponse, seed, testConfig, testDb, track, TZ, uri } from "./helpers";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

function setup(handler: Handler, now = () => 1_000_000_000_000) {
  const db = testDb();
  const config = testConfig();
  const fetch = mockFetch(handler);
  const auth = new SpotifyAuth(db, config, fetch.fn, now);
  const client = new SpotifyClient(db, auth, config, fetch.fn, now);
  return { db, config, auth, client, calls: fetch.calls, now };
}

function connect(db: ReturnType<typeof testDb>, expiresAt: number) {
  db.insert(spotifyAuthTable).values({ id: 1, accessToken: "old-access", refreshToken: "refresh-1", expiresAt, scope: "user-read-recently-played", updatedAt: 0 }).run();
}

const spotifyTrack = (id: string, name: string, artist: string, durationMs = 180000): SpotifyTrack => ({
  id,
  uri: uri(id),
  name,
  duration_ms: durationMs,
  artists: [{ id: "ar", name: artist, uri: "spotify:artist:ar" }],
  album: { id: "al", name: "Album", release_date: "2020-01-01", images: [{ url: "https://img/1", width: 640, height: 640 }] },
});

describe("token refresh", () => {
  test("persists the rotated refresh token and new expiry", async () => {
    const { db, auth, now } = setup(() => jsonResponse({ access_token: "new-access", refresh_token: "refresh-2", expires_in: 3600, scope: "a b" }));
    connect(db, now() - 1);
    expect(await auth.accessToken()).toBe("new-access");
    const row = db.select().from(spotifyAuthTable).get()!;
    expect(row.refreshToken).toBe("refresh-2");
    expect(row.expiresAt).toBe(now() + 3_600_000);
  });

  test("keeps the old refresh token when none is returned", async () => {
    const { db, auth, now } = setup(() => jsonResponse({ access_token: "new-access", expires_in: 3600 }));
    connect(db, now() - 1);
    await auth.accessToken();
    expect(db.select().from(spotifyAuthTable).get()!.refreshToken).toBe("refresh-1");
  });

  test("concurrent callers share one refresh so a rotated token is never reused", async () => {
    let n = 0;
    const { db, auth, now, calls } = setup(async () => {
      n++;
      await Bun.sleep(5);
      return jsonResponse({ access_token: `access-${n}`, refresh_token: `refresh-${n + 1}`, expires_in: 3600 });
    });
    connect(db, now() - 1);
    const tokens = await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()]);
    expect(new Set(tokens).size).toBe(1);
    expect(calls).toHaveLength(1);
  });

  test("a revoked refresh token disconnects Spotify", async () => {
    const { db, auth, now } = setup(() => jsonResponse({ error: "invalid_grant" }, 400));
    connect(db, now() - 1);
    await expect(auth.accessToken()).rejects.toThrow("invalid_grant");
    expect(auth.status().connected).toBe(false);
  });

  test("uses the cached access token while it is valid", async () => {
    const { db, auth, now, calls } = setup(() => jsonResponse({}));
    connect(db, now() + 3_600_000);
    expect(await auth.accessToken()).toBe("old-access");
    expect(calls).toHaveLength(0);
  });
});

describe("rate limits", () => {
  test("QUOTA_EXCEEDED pauses all calls for the long backoff without further requests", async () => {
    const { db, client, calls, now, config } = setup(() =>
      jsonResponse({ error: { status: 429, message: "quota", reason: "QUOTA_EXCEEDED" } }, 429, { "retry-after": "5" }),
    );
    connect(db, now() + 3_600_000);
    const error = await client.me().catch((e) => e);
    expect(error).toBeInstanceOf(SpotifyBlockedError);
    expect(error.reason).toBe("quota_exceeded");
    expect(client.gate()!.blockedUntil).toBe(now() + config.quotaBackoffMs);
    await expect(client.recentlyPlayed()).rejects.toBeInstanceOf(SpotifyBlockedError);
    expect(calls).toHaveLength(1);
  });

  test("an ordinary 429 pauses for Retry-After seconds", async () => {
    const { db, client, now } = setup(() => jsonResponse({ error: { status: 429, message: "slow down" } }, 429, { "retry-after": "30" }));
    connect(db, now() + 3_600_000);
    const error = await client.me().catch((e) => e);
    expect(error.reason).toBe("rate_limited");
    expect(client.gate()!.blockedUntil).toBe(now() + 30_000);
  });

  test("the pause expires", async () => {
    let t = 1_000_000_000_000;
    const { db, client } = setup(
      (url) => (url.endsWith("/me") && t > 1_000_000_100_000 ? jsonResponse({ id: "me", display_name: null }) : jsonResponse({}, 429, { "retry-after": "60" })),
      () => t,
    );
    connect(db, t + 3_600_000_000);
    await expect(client.me()).rejects.toBeInstanceOf(SpotifyBlockedError);
    t += 61_000 + 100_000;
    expect((await client.me()).id).toBe("me");
  });

  test("a 401 forces one refresh and retries", async () => {
    let apiCalls = 0;
    const { db, client, now } = setup((url) => {
      if (url.includes("accounts.spotify.com")) return jsonResponse({ access_token: "fresh", refresh_token: "refresh-2", expires_in: 3600 });
      apiCalls++;
      return apiCalls === 1 ? jsonResponse({ error: { message: "expired" } }, 401) : jsonResponse({ id: "me", display_name: null });
    });
    connect(db, now() + 3_600_000);
    expect((await client.me()).id).toBe("me");
    expect(db.select().from(spotifyAuthTable).get()!.refreshToken).toBe("refresh-2");
  });
});

describe("poller", () => {
  const items = (...entries: [string, SpotifyTrack][]) => ({ items: entries.map(([played_at, track]) => ({ played_at, track, context: null })) });

  test("dedupes plays seen in overlapping polls", async () => {
    let response = items(["2026-02-01T10:00:00.000Z", spotifyTrack("t1", "One", "Artist")]);
    const { db, client, config, now } = setup(() => jsonResponse(response));
    connect(db, now() + 3_600_000);
    expect((await pollRecentlyPlayed(db, client, config)).inserted).toBe(1);
    response = items(["2026-02-01T10:05:00.000Z", spotifyTrack("t2", "Two", "Artist")], ["2026-02-01T10:00:00.000Z", spotifyTrack("t1", "One", "Artist")]);
    const second = await pollRecentlyPlayed(db, client, config);
    expect(second).toEqual({ received: 2, inserted: 1, skippedCoveredByExport: 0 });
    const rows = db.all<{ source: string; ms_played: number | null }>(sql`select source, ms_played from plays`);
    expect(rows).toEqual([
      { source: "api", ms_played: null },
      { source: "api", ms_played: null },
    ]);
    const t = db.all<{ duration_ms: number; album_art_url: string }>(sql`select duration_ms, album_art_url from tracks where name = 'One'`)[0]!;
    expect(t).toEqual({ duration_ms: 180000, album_art_url: "https://img/1" });
  });

  test("ignores plays already covered by imported export rows", async () => {
    const { db, client, config, now } = setup(() =>
      jsonResponse(items(["2026-01-05T10:00:00.308Z", spotifyTrack("t1", "One", "Artist")], ["2026-01-06T09:00:00.000Z", spotifyTrack("t2", "Two", "Artist")])),
    );
    connect(db, now() + 3_600_000);
    importExport(
      db,
      [
        {
          name: "Streaming_History_Audio_2026.json",
          content: JSON.stringify([
            {
              ts: "2026-01-05T10:00:00Z",
              platform: "ios",
              ms_played: 1000,
              conn_country: "KW",
              master_metadata_track_name: "One",
              master_metadata_album_artist_name: "Artist",
              master_metadata_album_album_name: "Album",
              spotify_track_uri: uri("t1"),
              reason_start: "clickrow",
              reason_end: "fwdbtn",
              shuffle: false,
              skipped: true,
              offline: false,
              incognito_mode: false,
            },
          ]),
        },
      ],
      TZ,
    );
    expect(await pollRecentlyPlayed(db, client, config)).toEqual({ received: 2, inserted: 1, skippedCoveredByExport: 1 });
  });
});

describe("enrichment", () => {
  test("fills missing metadata a few tracks at a time and records failures", async () => {
    const { db, client, now } = setup((url) => (url.endsWith(encodeURIComponent("0".repeat(20) + "t2")) ? jsonResponse({ error: { message: "nope" } }, 404) : jsonResponse(spotifyTrack("t1", "Other name", "Other artist", 222000))));
    connect(db, now() + 3_600_000);
    seed(db, [track("t1", "One", "Artist", "Album"), track("t2", "Two", "Artist", "Album"), track("t3", "Three", "Artist", "Album")], []);
    const result = await enrichTracks(db, client, 2);
    expect(result).toEqual({ attempted: 2, enriched: 1, failed: 1 });
    const t1 = db.all<{ name: string; duration_ms: number; enriched_at: number | null }>(sql`select name, duration_ms, enriched_at from tracks where uri = ${uri("t1")}`)[0]!;
    expect(t1.name).toBe("One");
    expect(t1.duration_ms).toBe(222000);
    expect(t1.enriched_at).not.toBeNull();
    const next = await enrichTracks(db, client, 1);
    expect(next.attempted).toBe(1);
    expect(db.all<{ n: number }>(sql`select count(*) as n from tracks where enriched_at is null`)[0]!.n).toBe(1);
  });
});
