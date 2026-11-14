import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { spotifyAuth as spotifyAuthTable } from "../src/db/schema";
import { enrich, enrichmentProgress, fetchAlbumArt } from "../src/ingest/live/enrich";
import { setJobState } from "../src/jobs/state";
import { pollRecentlyPlayed } from "../src/ingest/live/poller";
import { importExport } from "../src/ingest/export/import";
import { SpotifyAuth } from "../src/spotify/auth";
import { SpotifyClient } from "../src/spotify/client";
import { SpotifyBlockedError } from "../src/spotify/errors";
import type { SpotifyTrack } from "../src/spotify/types";
import { jsonResponse, play, seed, testConfig, testDb, track, TZ, uri } from "./helpers";

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
    expect(second).toEqual({ received: 2, inserted: 1, skippedCoveredByExport: 0, skippedCoveredByLive: 0 });
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
    expect(await pollRecentlyPlayed(db, client, config)).toEqual({ received: 2, inserted: 1, skippedCoveredByExport: 1, skippedCoveredByLive: 0 });
  });
});

describe("enrichment", () => {
  const artistBody = (id: string) => ({ id, name: `Name ${id}`, images: [{ url: `https://img/${id}`, width: 640, height: 640 }] });

  test("works through tracks and artists by listens, one call per step, and records failures", async () => {
    const { db, client, now, calls } = setup((url) => {
      if (url.includes("/artists/")) return jsonResponse(artistBody(url.split("/artists/")[1]!));
      if (url.endsWith("t2")) return jsonResponse({ error: { message: "nope" } }, 404);
      return jsonResponse({ ...spotifyTrack("t1", "Other name", "Other artist", 222000), artists: [{ id: "ar1", name: "Lead", uri: "spotify:artist:ar1" }, { id: "ar2", name: "Feature", uri: "spotify:artist:ar2" }] });
    });
    connect(db, now() + 3_600_000);
    seed(db, [track("t1", "One", "Lead", "Album"), track("t2", "Two", "Lead", "Album")], [play("2026-01-01T10:00:00Z", uri("t1"), 200000), play("2026-01-02T10:00:00Z", uri("t1"), 200000)]);

    expect(await enrich(db, client, 1)).toEqual({ tracks: 1, artists: 0, failed: 0 });
    const t1 = db.all<{ name: string; duration_ms: number; enriched_at: number | null; album_art_url: string }>(sql`select name, duration_ms, enriched_at, album_art_url from tracks where uri = ${uri("t1")}`)[0]!;
    expect(t1).toMatchObject({ name: "One", duration_ms: 222000, album_art_url: "https://img/1" });
    expect(t1.enriched_at).not.toBeNull();
    expect(db.all(sql`select artist_id, position from track_artists order by position`)).toEqual([
      { artist_id: "ar1", position: 0 },
      { artist_id: "ar2", position: 1 },
    ]);

    expect(await enrich(db, client, 2)).toEqual({ tracks: 0, artists: 2, failed: 0 });
    expect(db.all(sql`select id, image_url from artists order by id`)).toEqual([
      { id: "ar1", image_url: "https://img/ar1" },
      { id: "ar2", image_url: "https://img/ar2" },
    ]);

    expect(await enrich(db, client, 5)).toEqual({ tracks: 3, artists: 0, failed: 3 });
    expect(await enrich(db, client, 5)).toEqual({ tracks: 0, artists: 0, failed: 0 });
    expect(enrichmentProgress(db)).toEqual({ total: 2, enriched: 1, failed: 1, withArt: 1, artists: { total: 2, fetched: 2, withImage: 2 } });
    expect(calls.filter((c) => c.url.includes("api.spotify.com"))).toHaveLength(6);
  });

  test("album art comes from oEmbed without a token and continues while the Web API is paused", async () => {
    const { db, client, now, calls } = setup((url) => (url.includes("t2") ? jsonResponse({}, 404) : jsonResponse({ thumbnail_url: "https://thumb/1" })));
    seed(db, [track("t1", "One", "A", "Album"), track("t2", "Two", "A", "Album")], [play("2026-01-01T10:00:00Z", uri("t1"), 200000)]);
    expect(await fetchAlbumArt(db, client, 5)).toEqual({ attempted: 2, found: 1, failed: 1 });
    expect(calls[0]!.url).toBe(`https://open.spotify.com/oembed?url=${encodeURIComponent(`spotify:track:${uri("t1").split(":")[2]}`)}`);
    expect(calls[0]!.init?.headers).toBeUndefined();
    expect(db.all(sql`select uri, album_art_url, art_attempts from tracks order by uri`)).toEqual([
      { uri: uri("t1"), album_art_url: "https://thumb/1", art_attempts: 0 },
      { uri: uri("t2"), album_art_url: null, art_attempts: 1 },
    ]);
    setJobState(db, "spotify", { data: { reason: "rate_limited", blockedUntil: now() + 60_000, at: now() } });
    expect(await fetchAlbumArt(db, client, 5)).toEqual({ attempted: 1, found: 0, failed: 1 });
    expect(calls).toHaveLength(3);
  });

  test("Web API calls are counted per UTC day; oEmbed calls are not", async () => {
    const { db, client, now } = setup((url) => jsonResponse(url.includes("oembed") ? { thumbnail_url: "https://thumb/1" } : { id: "me" }));
    connect(db, now() + 3_600_000);
    seed(db, [track("t1", "One", "A", "Album")], []);
    await client.me();
    await client.me();
    await fetchAlbumArt(db, client, 5);
    expect(client.callsToday()).toBe(2);
  });

  test("polled rows keep the playlist or album they were played from", async () => {
    const { db, client, config, now } = setup(() =>
      jsonResponse({
        items: [
          { played_at: "2026-11-01T10:00:00Z", track: spotifyTrack("t8", "Eight", "Lead"), context: { uri: "spotify:playlist:abc", type: "playlist" } },
          { played_at: "2026-11-01T09:00:00Z", track: spotifyTrack("t7", "Seven", "Lead"), context: null },
        ],
      }),
    );
    connect(db, now() + 3_600_000);
    await pollRecentlyPlayed(db, client, config);
    expect(db.all(sql`select track_uri, context_uri from plays order by ts`)).toEqual([
      { track_uri: uri("t7"), context_uri: null },
      { track_uri: uri("t8"), context_uri: "spotify:playlist:abc" },
    ]);
  });

  test("polled tracks link their artists", async () => {
    const { db, client, config, now } = setup(() => jsonResponse({ items: [{ played_at: "2026-11-01T10:00:00Z", track: spotifyTrack("t9", "Nine", "Lead"), context: null }] }));
    connect(db, now() + 3_600_000);
    await pollRecentlyPlayed(db, client, config);
    expect(db.all(sql`select ta.track_uri, a.name from track_artists ta join artists a on a.id = ta.artist_id`)).toEqual([{ track_uri: uri("t9"), name: "Lead" }]);
  });
});
