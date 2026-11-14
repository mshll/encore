/*
  Dev only (imported behind import.meta.env.DEV, absent from the production bundle).
  Feeds every state through the real data path by wrapping fetch for /api requests:

    ?fixture=loading  every API read hangs
    ?fixture=error    every API read answers 500
    ?fixture=empty    a range with no plays
    ?fixture=new      a fresh install: nothing imported yet
    ?fixture=worst    real data bent to the limits: long names, huge counts, one-row lists, broken art
    ?fixture=untagged plays but no tagged songs (Patterns: Taste)
    ?player=playing   a fake track and queue; player controls answer ok without calling Spotify

  The choice sticks for the tab (sessionStorage) so in-app navigation keeps it; ?fixture=off clears it.
*/

type Json = Record<string, unknown>;

const params = new URLSearchParams(location.search);
for (const key of ["fixture", "player"]) {
  const value = params.get(key);
  if (value === "off") sessionStorage.removeItem(`encore-${key}`);
  else if (value) sessionStorage.setItem(`encore-${key}`, value);
}
const fixture = sessionStorage.getItem("encore-fixture");
const player = sessionStorage.getItem("encore-player");

const LONG_ARTIST = "Bùi Thị Xuân Hương and the Extraordinarily Long-Named Orchestra of Hồ Chí Minh City";
const LONG_SONG = "Somewhere Only We Know (Live at the Royal Albert Hall, 14 February 2004) [2024 Remaster]";
const LONG_ALBUM = "สวัสดีครับ: The Complete Recordings, Volume One Through Seventeen (Deluxe Anniversary Edition)";
/** An image that fails to decode: exercises the artwork fallback without a network request. */
const BROKEN_ART = "data:image/png;base64,AAAA";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SPLIT_PARAMS = { params: { minPlays: 8, minContextPlays: 5, keeperBelow: 0.25, dislikeAtLeast: 0.75, worksAtMost: 1 / 3, failsAtLeast: 2 / 3 } };

const ZERO_STATS = { hours: 0, plays: 0, listens: 0, skips: 0, skipRate: null, quickSkips: 0, firstPlayed: null, lastPlayed: null };

function emptyFor(path: string, isNew: boolean): unknown {
  if (path === "/api/stats/overview")
    return { ...ZERO_STATS, uniqueTracks: 0, uniqueArtists: 0, shuffleRate: null, topArtist: null, topTrack: null, firstPlayed: isNew ? null : "2021-05-16T06:56:32.000Z" };
  if (path === "/api/stats/timeseries") return { period: "day", points: [] };
  if (path.startsWith("/api/stats/top/")) return { items: [] };
  if (path === "/api/stats/clock") return { cells: Array.from({ length: 168 }, (_, i) => ({ weekday: Math.floor(i / 24) + 1, hour: i % 24, hours: 0, plays: 0 })) };
  if (path === "/api/stats/on-this-day") return { date: "2026-11-14", years: [] };
  if (path === "/api/history") return { total: 0, limit: 200, offset: 0, items: [] };
  if (path === "/api/search") return { artists: [], songs: [], albums: [] };
  if (path === "/api/radar") return { artists: 0, withId: 0, checkedRecently: 0, unseenNew: 0, lastRunAt: null, items: [] };
  if (path === "/api/digests") return { items: [] };
  if (path === "/api/stats/eras") return { months: [], series: [], artists: [] };
  if (path === "/api/stats/skips")
    return {
      minPlays: 10,
      summary: { plays: 0, skips: 0, skipRate: null, quickSkips: 0 },
      mostSkippedTracks: [],
      mostSkippedArtists: [],
      quickSkips: [],
      neverSkipped: [],
      profile: { hourBucket: [], dayType: [], shuffle: [], device: [], startMode: [] },
      positions: Array.from({ length: 10 }, (_, i) => ({ start: i / 10, end: (i + 1) / 10, skips: 0 })),
    };
  if (path === "/api/stats/skips/split") return { ...SPLIT_PARAMS, eligibleSongs: 0, counts: { keeper: 0, wrong_moment: 0, dislike: 0, mixed: 0 }, songs: [] };
  if (path === "/api/stats/trips") return { homeCountry: "KW", trips: [] };
  if (path === "/api/stats/devices") return { period: "year", totals: [], series: [] };
  if (path === "/api/stats/tags/genres" || path === "/api/stats/tags/moods") return { period: "month", coverage: { hoursTagged: 0, hoursTotal: 0, share: null }, totals: [], series: [] };
  if (path === "/api/stats/tags/energy") return { coverage: { hoursTagged: 0, hoursTotal: 0, share: null }, hours: Array.from({ length: 24 }, (_, hour) => ({ hour, energy: null, valence: null, listens: 0 })) };
  if (path === "/api/tags/pending") return { items: [], total: 0, limit: 1, offset: 0 };
  if (path === "/api/cleanup") return { counts: { saved_never_played: 0, saved_dislike: 0, playlist_skipped: 0, playlist_duplicate: 0 }, library: { savedTracks: 0, playlists: 0, syncing: false, lastSyncAt: null }, total: 0, limit: 500, offset: 0, items: [] };
  return null;
}

function worsen(path: string, body: Json): unknown {
  if (path === "/api/stats/overview")
    return {
      ...body,
      hours: 123456.7,
      plays: 9876543,
      listens: 8765432,
      uniqueTracks: 123456,
      uniqueArtists: 54321,
      topArtist: body.topArtist ? { ...(body.topArtist as Json), artist: LONG_ARTIST, imageUrl: null } : null,
    };
  if (path.startsWith("/api/stats/top/")) {
    const items = (body.items as Json[]).slice(0, 2).map((it, i) => ({
      ...it,
      ...(i === 0 ? { artist: LONG_ARTIST, name: LONG_SONG, album: LONG_ALBUM, albumArtUrl: BROKEN_ART, imageUrl: null, hours: 98765.4, plays: 1234567 } : {}),
    }));
    return { items: items.slice(0, path.includes("albums") ? 1 : 2) };
  }
  if (path === "/api/stats/timeseries") return { ...body, points: (body.points as Json[]).slice(-1) };
  if (path === "/api/stats/clock") {
    const cells = (body.cells as Json[]).map((c, i) => ({ ...c, hours: i === 100 ? 4321.5 : i % 37 === 0 ? 0.01 : 0, plays: i === 100 ? 98765 : i % 37 === 0 ? 1 : 0 }));
    return { cells };
  }
  if (path === "/api/stats/eras") {
    const artists = (body.artists as Json[]).slice(0, 2).map((a, i) => (i === 0 ? { ...a, artist: LONG_ARTIST, imageUrl: null, hours: 98765.4, peakMonthHours: 98765.4 } : a));
    const series = (body.series as { artist: string; hours: number[] }[]).slice(0, 2).map((x, i) => ({ artist: i === 0 ? LONG_ARTIST : x.artist, hours: i === 0 ? [98765.4] : x.hours.slice(-1) }));
    return { months: (body.months as string[]).slice(-1), series, artists };
  }
  if (path === "/api/stats/skips") return { ...body, summary: { plays: 9876543, skips: 4938271, skipRate: 0.5, quickSkips: 4938271 } };
  if (path === "/api/stats/skips/split") {
    const songs = (body.songs as Json[]).slice(0, 1).map((x) => ({ ...x, name: LONG_SONG, artist: LONG_ARTIST, albumArtUrl: BROKEN_ART, plays: 98765 }));
    return { ...body, eligibleSongs: 1234567, counts: { keeper: 123456, wrong_moment: 987654, dislike: 1, mixed: 0 }, songs };
  }
  if (path === "/api/stats/trips") {
    const trip = (body.trips as Json[])[0];
    if (!trip) return body;
    const countries = ["GB", "TR", "BA", "VN", "TH", "XK"].map((country, i) => ({ country, plays: 98765 - i * 1000 }));
    const topTracks = (trip.topTracks as Json[]).slice(0, 1).map((t) => ({ ...t, name: LONG_SONG, artist: LONG_ARTIST, albumArtUrl: BROKEN_ART, plays: 98765 }));
    return { ...body, trips: [{ ...trip, days: 365, plays: 987654, hours: 12345.6, countries, topTracks }] };
  }
  if (path === "/api/stats/devices") return { ...body, totals: [{ device: "other", hours: 123456.7, plays: 9876543, share: 1 }] };
  if (path === "/api/stats/tags/genres" || path === "/api/stats/tags/moods") {
    const top = (body.totals as Json[])[0];
    if (!top) return body;
    return { ...body, coverage: { hoursTagged: 123456.7, hoursTotal: 123456.7, share: 1 }, totals: [{ ...top, value: "singer-songwriter", hours: 98765.4 }], series: (body.series as Json[]).filter((p) => p.value === top.value).map((p) => ({ ...p, value: "singer-songwriter" })) };
  }
  if (path === "/api/history") {
    const items = (body.items as Json[]).map((it, i) =>
      i % 5 === 0 ? { ...it, name: LONG_SONG, artist: LONG_ARTIST, album: LONG_ALBUM, albumArtUrl: i % 10 === 0 ? BROKEN_ART : null, msPlayed: 35999999 } : it,
    );
    return { ...body, total: 1284, items: items.slice(0, Math.min(items.length, 1284)) };
  }
  return body;
}

const PLAYING_NOW = {
  playing: true,
  track: { uri: "spotify:track:3aBGKDiAAvH2H7HLOyQ4US", name: "Glimpse of Us", artist: "Joji", album: "SMITHEREENS", albumArtUrl: null, durationMs: 233000 },
  progressMs: 61000,
  shuffle: true,
  device: { name: "MacBook Pro", type: "Computer" },
  contextUri: null,
};

const realFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  const path = url.pathname;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!path.startsWith("/api/") || path.startsWith("/api/auth/")) return realFetch(input, init);

  if (player === "playing") {
    if (path === "/api/player/now") return json({ ...PLAYING_NOW, fetchedAt: new Date().toISOString() });
    if (path === "/api/player/queue") {
      const top = await realFetch("/api/stats/top/tracks?limit=8").then((r) => r.json() as Promise<{ items: Json[] }>);
      return json({ current: null, queue: top.items.map((s) => ({ uri: s.uri, name: s.name, artist: s.artist, albumArtUrl: s.albumArtUrl })) });
    }
    if (method === "POST" && path.startsWith("/api/player/")) return json({ ok: true });
  }
  if (!fixture || method !== "GET") return realFetch(input, init);
  if (path === "/api/status" || path === "/api/player/now" || path === "/api/player/queue") return realFetch(input, init);

  if (fixture === "loading") return new Promise<Response>(() => {});
  if (fixture === "error") return json({ error: { code: "internal", message: "The database is locked by another process." } }, 500);
  const lifetime = path === "/api/stats/overview" && !url.searchParams.has("from") && !url.searchParams.has("to");
  if (fixture === "empty" && lifetime) return realFetch(input, init);
  if (fixture === "empty" || fixture === "new") {
    const body = emptyFor(path, fixture === "new");
    if (body !== null) return json(body);
    return realFetch(input, init);
  }
  if (fixture === "untagged") {
    if (path === "/api/stats/tags/genres" || path === "/api/stats/tags/moods") return json({ period: "month", coverage: { hoursTagged: 0, hoursTotal: 1444.74, share: 0 }, totals: [], series: [] });
    if (path === "/api/stats/tags/energy") return json({ coverage: { hoursTagged: 0, hoursTotal: 1444.74, share: 0 }, hours: Array.from({ length: 24 }, (_, hour) => ({ hour, energy: null, valence: null, listens: 0 })) });
    if (path === "/api/tags/pending") return json({ items: [], total: 5055, limit: 1, offset: 0 });
    return realFetch(input, init);
  }
  if (fixture === "worst") {
    if (path === "/api/entities/artist" && url.searchParams.get("name") === LONG_ARTIST) {
      const profile = { hourBucket: [], dayType: [], shuffle: [], device: [], startMode: [] };
      const song = { songKey: "worst|worst", uri: "spotify:track:0000000000000000000000", name: LONG_SONG, artist: LONG_ARTIST, album: LONG_ALBUM, albumArtUrl: BROKEN_ART, ...ZERO_STATS, hours: 98765.4, plays: 1234567 };
      return json({ artist: LONG_ARTIST, imageUrl: null, totals: { ...ZERO_STATS, hours: 98765.4, plays: 1234567 }, timeline: [], skipProfile: profile, tracks: [song], albums: [] });
    }
    const res = await realFetch(input, init);
    if (!res.ok) return res;
    return json(worsen(path, (await res.json()) as Json));
  }
  return realFetch(input, init);
};

export {};
