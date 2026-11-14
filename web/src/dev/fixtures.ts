/*
  Dev only (imported behind import.meta.env.DEV, absent from the production bundle).
  Feeds every state through the real data path by wrapping fetch for /api requests:

    ?fixture=loading  every API read hangs
    ?fixture=error    every API read answers 500
    ?fixture=empty    a range with no plays
    ?fixture=new      a fresh install: nothing imported yet, setup not complete
    ?fixture=worst    real data bent to the limits: long names, huge counts, one-row lists, broken art, long Ask and set threads,
                      a spent Claude budget, an unreadable stored key, applied and undone cleanup batches,
                      a finished setup
    ?fixture=untagged plays but no tagged songs (Patterns: Taste)
    ?player=playing   a fake track and queue; player controls answer ok without calling Spotify
    ?dj=active        a DJ session playing from the newest set; starting and stopping one answer ok without calling Spotify
    ?run=running      every Claude run (picks, sets, ask) is working: resumes on load, streams steps, never ends
    ?run=starting     starting a run hangs before the server answers
    ?run=done         a started run streams steps, then finishes with real data from the database
    ?run=failed       a started run streams steps, then fails (llm_failed)
    ?run=budget       the monthly Claude cap is spent (status and the run answer 402)
    ?run=unconfigured Claude has no API key (status and the run answer 503)
    ?run=paused       Spotify calls are paused (status and the run answer 503 spotify_paused)
    Every run fixture answers POSTs itself: no Claude call, no Spotify call.
    ?settings=env     every setting is set by an env var, none saved in the dashboard yet
    ?settings=stored  every setting is set by an env var and also saved in the dashboard
    ?settings=mixed   Spotify, locale and Claude settings are set by env vars, the rest are not; no SECRETS_KEY
    Settings fixtures answer POST /api/settings/adopt-env themselves: nothing is written.
    ?history=before   "Ignore plays before": 269 plays before any date; applying answers success
    ?history=none     no plays before any date; applying only saves
    ?history=slow     the count of plays before a date never answers
    ?history=failed   applying fails: the database snapshot could not be written
    ?history=env      HISTORY_START sets 2024-01-01 and 269 plays before it are still stored
    History fixtures answer GET and POST /api/settings/history-start and GET /api/settings themselves: nothing is written.
    ?living=connected  For you, Playlists: Spotify connected with every permission, real playlists from the database
    ?living=first      every playlist off (first use)
    ?living=fresh      Most played lately is on but not in Spotify yet
    ?living=deferred   Most played lately waits because it is playing
    ?living=failed     Most played lately: the last refresh failed
    ?living=empty      Most played lately has nothing new; This month in past years has nothing at all
    ?living=removed    Forgotten favourites was deleted in Spotify
    ?living=scope      Spotify connected without permission to change playlists
    ?living=refreshing switching on or off and Refresh now never answer
    Living fixtures answer PATCH /api/living/:kind and POST /api/living/:kind/refresh themselves: nothing is written, no Spotify call.

  The choice sticks for the tab (sessionStorage) so in-app navigation keeps it; ?fixture=off clears it.
*/

type Json = Record<string, unknown>;

const params = new URLSearchParams(location.search);
for (const key of ["fixture", "player", "run", "dj", "settings", "history", "living"]) {
  const value = params.get(key);
  if (value === "off") sessionStorage.removeItem(`encore-${key}`);
  else if (value) sessionStorage.setItem(`encore-${key}`, value);
}
const fixture = sessionStorage.getItem("encore-fixture");
const player = sessionStorage.getItem("encore-player");
const run = sessionStorage.getItem("encore-run");
const dj = sessionStorage.getItem("encore-dj");
const settingsFixture = sessionStorage.getItem("encore-settings");
const historyFixture = sessionStorage.getItem("encore-history");
const livingFixture = sessionStorage.getItem("encore-living");

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
  if (path === "/api/stats/forgotten") return { days: 180, minListens: 10, asOf: "2026-11-14T00:00:00.000Z", items: [] };
  if (path === "/api/search") return { artists: [], songs: [], albums: [] };
  if (path === "/api/radar") return { artists: 0, withId: 0, checkedRecently: 0, unseenNew: 0, lastRunAt: null, items: [] };
  if (path === "/api/digests") return { items: [] };
  if (path === "/api/picks") return { week: "2026-11-09", picks: [], stats: { settled: 0, played: 0, hits: 0, hitRate: null }, playlist: null };
  if (path === "/api/picks/weeks") return { items: [] };
  if (path === "/api/blocks") return { items: [] };
  if (path === "/api/sets") return { items: [], total: 0, limit: 100, offset: 0 };
  if (path === "/api/ask/threads") return { items: [] };
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
  if (path === "/api/cleanup/batches" || path === "/api/blocks") return { items: [] };
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
  if (path.startsWith("/api/entities/")) {
    const tracks = ((body.tracks as Json[] | undefined) ?? []).slice(0, 1).map((t) => ({ ...t, name: LONG_SONG, artist: LONG_ARTIST, album: LONG_ALBUM, albumArtUrl: BROKEN_ART, hours: 98765.4, plays: 1234567 }));
    const totals = { ...(body.totals as Json), hours: 123456.7, plays: 9876543, listens: 8765432, skips: 4567890, quickSkips: 1234567 };
    return {
      ...body,
      ...(body.artist ? { artist: LONG_ARTIST } : {}),
      ...(body.album ? { album: LONG_ALBUM } : {}),
      ...(body.name ? { name: LONG_SONG } : {}),
      imageUrl: body.imageUrl === undefined ? undefined : BROKEN_ART,
      albumArtUrl: body.albumArtUrl === undefined ? undefined : BROKEN_ART,
      totals,
      timeline: ((body.timeline as Json[]) ?? []).slice(-1),
      tracks,
      ...(body.albums ? { albums: (body.albums as Json[]).slice(0, 1).map((a) => ({ ...a, album: LONG_ALBUM, albumArtUrl: BROKEN_ART })) } : {}),
      ...(body.uris ? { uris: (body.uris as Json[]).map((u) => ({ ...u, name: LONG_SONG, album: LONG_ALBUM })) } : {}),
    };
  }
  if (path === "/api/stats/forgotten") {
    const items = (body.items as Json[]).slice(0, 1).map((it) => ({ ...it, name: LONG_SONG, artist: LONG_ARTIST, albumArtUrl: BROKEN_ART, listens: 1234567 }));
    return { ...body, items };
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
  if (path === "/api/picks") {
    const picks = (body.picks as Json[]).slice(0, 2).map((p, i) =>
      i === 0
        ? {
            ...p,
            name: LONG_SONG,
            artist: LONG_ARTIST,
            album: LONG_ALBUM,
            albumArtUrl: BROKEN_ART,
            reason: `${p.reason as string} ${p.reason as string}`,
            source: { url: "https://example.com", title: LONG_ALBUM },
          }
        : {
            ...p,
            albumArtUrl: null,
            source: null,
            state: "saved",
            outcome: { plays: 123456, finished: 98765, playDays: 321, inLibrary: true, firstPlayedAt: null, hit: true },
          },
    );
    return { ...body, picks, stats: { settled: 123456, played: 98765, hits: 54321, hitRate: 0.44 } };
  }
  if (path === "/api/picks/weeks") return { items: (body.items as Json[]).concat({ week: "2026-11-02", picks: 1, played: 1 }) };
  if (path === "/api/living") return { ...body, items: (body.items as Json[]).map((p, i) => (i === 1 ? { ...p, count: 1, available: 1 } : p)) };
  if (/^\/api\/living\/[a-z-]+$/.test(path)) {
    const items = (body.items as Json[]).slice(0, 2).map((s, i) => (i === 0 ? { ...s, name: LONG_SONG, artist: LONG_ARTIST, album: LONG_ALBUM, albumArtUrl: BROKEN_ART } : s));
    const history = (body.history as Json[]).slice(0, 1).map((h) => ({ ...h, count: 1, added: Array.from({ length: 1284 }, () => ({})), removed: Array.from({ length: 999 }, () => ({})) }));
    return { ...body, count: items.length, items, history };
  }
  if (path === "/api/radar") {
    const items: Json[] = (body.items as Json[]).map((r) => ({ ...r, name: LONG_SONG, artist: LONG_ARTIST, imageUrl: BROKEN_ART, totalTracks: 1234 }));
    return {
      ...body,
      artists: 123456,
      items: items.concat(items.map((r) => ({ ...r, id: `${String(r.id)}-x2`, name: "สวัสดี", artist: "Ado", albumType: "album", imageUrl: null, seen: true }))),
    };
  }
  if (path === "/api/sets") {
    const items = (body.items as Json[]).slice(0, 1).map((it) => ({ ...it, title: LONG_ALBUM, tracks: 123456, coverUrl: BROKEN_ART }));
    return { ...body, total: 1, items };
  }
  if (/^\/api\/sets\/\d+$/.test(path)) {
    const items = (body.items as Json[])
      .slice(0, 2)
      .map((it, i) => (i === 0 ? { ...it, name: LONG_SONG, artist: LONG_ARTIST, album: LONG_ALBUM, albumArtUrl: BROKEN_ART, pinned: true } : it));
    const talk = Array.from({ length: 6 }, (_, i) => [
      { role: "owner", text: i % 2 ? `Swap ${LONG_SONG} for something by ${LONG_ARTIST}, and keep the slower start` : "Less sad" },
      { role: "assistant", text: `Changed it: ${"a brighter middle, ".repeat(i + 2)}and the same ending.` },
    ]).flat();
    return { ...body, title: LONG_ALBUM, description: `${body.description as string} ${LONG_SONG}`, items, conversation: [...(body.conversation as Json[]), ...talk] };
  }
  if (/^\/api\/ask\/threads\/\d+$/.test(path)) {
    const turns = body.turns as Json[];
    const long = Array.from({ length: 6 }, (_, i) => [{ role: "owner", text: i % 2 ? `${LONG_SONG} by ${LONG_ARTIST}: when did I play it most?` : "And on weekdays?" }, ...turns.slice(1)]).flat();
    return { ...body, turns: [...turns, ...long] };
  }
  if (path === "/api/ask/threads") return { items: (body.items as Json[]).slice(0, 1).map((t) => ({ ...t, title: `${LONG_SONG} ${LONG_ARTIST}?` })) };
  if (path === "/api/cleanup") {
    const items = (body.items as Json[]).slice(0, 2).map((it, i) => ({
      ...it,
      evidence: { ...(it.evidence as Json), name: i === 0 ? LONG_SONG : (it.evidence as Json).name, artist: LONG_ARTIST, albumArtUrl: i === 0 ? BROKEN_ART : null, plays: 98765, listens: 1, playlistName: LONG_ALBUM },
    }));
    return { ...body, counts: { saved_never_played: 1, saved_dislike: 123456, playlist_skipped: 0, playlist_duplicate: 2 }, total: items.length, items };
  }
  if (path === "/api/cleanup/batches")
    return {
      items: [
        { id: 2, proposalIds: [1], actions: 1, appliedAt: new Date(Date.now() - 3_600_000).toISOString(), undoneAt: null },
        { id: 1, proposalIds: [2, 3], actions: 123456, appliedAt: "2026-10-01T10:00:00.000Z", undoneAt: "2026-10-02T10:00:00.000Z" },
      ],
    };
  if (path === "/api/blocks") return { items: [{ id: 1, kind: "artist", key: "x", label: LONG_ARTIST, reason: "never on weekly pick 2026-11-09", createdAt: "2026-11-09T10:00:00.000Z" }] };
  if (path === "/api/digests") return { items: (body.items as Json[]).slice(0, 1) };
  if (/^\/api\/digests\/\d+$/.test(path))
    return {
      ...body,
      text: `${LONG_ARTIST} took ${"over ".repeat(30)}the week.\n\n${String(body.text)}`,
      facts: { ...(body.facts as Json), topArtists: [{ artist: LONG_ARTIST, hours: 98765.4, baselineHours: 0 }] },
    };
  if (path === "/api/onboarding") {
    const steps = Object.fromEntries(Object.entries(body.steps as Record<string, Json>).map(([k, v]) => [k, { ...v, done: true }]));
    return { ...body, complete: true, steps: { ...steps, spotifyConnect: { ...steps.spotifyConnect, userId: LONG_ARTIST }, import: { ...steps.import, exportPlays: 9876543 } } };
  }
  if (path === "/api/llm/spend") return { ...body, budget: { month: "2026-11", spentUsd: 123.45, capUsd: 100, remainingUsd: 0, exhausted: true } };
  if (path === "/api/settings")
    return {
      ...body,
      groups: (body.groups as { fields: Json[] }[]).map((g) => ({ ...g, fields: g.fields.map((f) => (f.key === "claudeApiKey" ? { ...f, set: true, unreadable: true, source: "db" } : f)) })),
    };
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

const MIXED_ENV_GROUPS = ["spotify", "locale", "claude"];
const ENV_SAMPLES: Record<string, unknown> = { spotifyClientId: "3f9a1c0b7d2e4a6b8c0d1e2f3a4b5c6d", homeCountry: "KW", discordPublicKey: "a".repeat(64) };
let settingsAdopted = settingsFixture === "stored";

/** The real settings with fields moved to env, as an install configured only by env vars reads. */
async function envSettings(): Promise<Json & { groups: { id: string; fields: Json[] }[] }> {
  const body = (await realFetch("/api/settings").then((r) => r.json())) as Json & { groups: { id: string; fields: Json[] }[] };
  const mixed = settingsFixture === "mixed";
  const groups = body.groups.map((g) =>
    mixed && !MIXED_ENV_GROUPS.includes(g.id)
      ? g
      : {
          ...g,
          fields: g.fields.map((f) => ({
            ...f,
            value: f.secret ? null : (f.value ?? ENV_SAMPLES[f.key as string] ?? "123456789012345678"),
            source: "env",
            locked: true,
            set: true,
            hint: f.secret ? "WXYZ" : null,
            unreadable: false,
            stored: settingsAdopted && !(mixed && f.secret),
          })),
        },
  );
  return { ...body, groups, secretStorage: { available: !mixed, envVar: "SECRETS_KEY" } };
}

async function settingsFixtureAnswer(path: string, method: string): Promise<Response | null> {
  if (path === "/api/settings" && method === "GET") return json(await envSettings());
  if (path !== "/api/settings/adopt-env" || method !== "POST") return null;
  settingsAdopted = true;
  const view = await envSettings();
  const env = view.groups.flatMap((g) => g.fields).filter((f) => f.source === "env");
  return json({
    ...view,
    adopted: env.filter((f) => f.stored).map((f) => f.key),
    replaced: [],
    skipped: env.filter((f) => !f.stored).map((f) => ({ key: f.key, reason: "secrets_key_missing" })),
  });
}

const EARLY_PLAYS = { plays: 269, firstDay: "2021-05-16", lastDay: "2021-09-27", hours: 11.9 };
let fixtureHistoryStart: string | null = historyFixture === "env" ? "2024-01-01" : null;
let fixtureRemoved = false;

async function historySettings(): Promise<Json> {
  const body = (await realFetch("/api/settings").then((r) => r.json())) as Json & { groups: { id: string; fields: Json[] }[] };
  const env = historyFixture === "env";
  const groups = body.groups.map((g) => ({
    ...g,
    fields: g.fields.map((f) =>
      f.key === "historyStart"
        ? { ...f, value: fixtureHistoryStart, set: fixtureHistoryStart !== null, source: env ? "env" : fixtureHistoryStart ? "db" : "default", locked: env, stored: !env && fixtureHistoryStart !== null }
        : f,
    ),
  }));
  return { ...body, groups };
}

async function historyFixtureAnswer(path: string, method: string, init: RequestInit | undefined): Promise<Response | null> {
  if (path === "/api/settings" && method === "GET") return json(await historySettings());
  if (path === "/api/settings" && method === "PATCH") {
    const patch = JSON.parse(String(init?.body ?? "{}")) as Json;
    if (!("historyStart" in patch)) return null;
    fixtureHistoryStart = (patch.historyStart as string | null) || null;
    return json({ ...(await historySettings()), changed: ["historyStart"], effects: [] });
  }
  if (path !== "/api/settings/history-start") return null;
  const before = historyFixture === "none" || fixtureRemoved ? { plays: 0, firstDay: null, lastDay: null, hours: 0 } : EARLY_PLAYS;
  if (method === "GET") return historyFixture === "slow" ? new Promise<Response>(() => {}) : json(before);
  if (historyFixture === "failed") return json({ error: { code: "snapshot_failed", message: "Could not write a snapshot of the database, so nothing was deleted" } }, 500);
  await new Promise((resolve) => setTimeout(resolve, 600));
  if (historyFixture !== "env") fixtureHistoryStart = (JSON.parse(String(init?.body ?? "{}")) as { historyStart: string }).historyStart;
  fixtureRemoved = true;
  return json({ ...(await historySettings()), removed: before, snapshot: before.plays > 0 ? "encore-2026-11-14T20-00-00Z.db" : null });
}

async function djSession() {
  const sets = (await realFetch("/api/sets").then((r) => r.json())) as { items: { id: number; title: string }[] };
  const set = sets.items[0];
  const detail = set ? ((await realFetch(`/api/sets/${set.id}`).then((r) => r.json())) as { items: { uri: string }[] }) : { items: [] };
  const uris = detail.items.map((i) => i.uri);
  return {
    id: 99,
    status: "active",
    playlistUri: "spotify:playlist:fixture",
    position: 4,
    current: uris[4] ?? null,
    upcoming: uris.slice(5),
    played: uris.slice(0, 4).map((uri, i) => ({ uri, outcome: i === 2 ? "skipped" : "finished" })),
    skipStreak: 0,
    replans: 1,
    replannedAt: new Date(Date.now() - 600_000).toISOString(),
    replanSkips: 2,
    set: set ? { id: set.id, title: set.title } : null,
    startedAt: new Date(Date.now() - 1_200_000).toISOString(),
    endedAt: null,
    endReason: null,
  };
}

const RUN_PATHS = [/^\/api\/picks\/generate$/, /^\/api\/sets$/, /^\/api\/sets\/\d+\/messages$/, /^\/api\/ask$/];
const RUN_ID = "fixture-run";

const STEPS: { name: string; input: Json }[] = [
  { name: "find_songs", input: { hourBucket: "night", dayType: "weekday", genres: ["r&b", "soul"] } },
  { name: "artist_profile", input: { artist: "Mac Miller" } },
  { name: "find_songs", input: { artists: ["Frank Ocean"], notPlayedForDays: 180 } },
  { name: "verify_new_song", input: { title: "Pink + White", artist: "Frank Ocean" } },
  { name: "song_history", input: { artist: "Joji" } },
  { name: "verify_new_song", input: { title: "Self Control", artist: "Frank Ocean" } },
];

const ANSWER =
  "You played Mac Miller most on weekday nights: 412 plays after 22:00 against 96 in the morning. Circles carries most of it, with Good News finished 38 times.\n\nBased on: your plays from January to November 2026.";

type Frame = [event: string, data: unknown, delayMs: number];

/** Server-Sent Events from a list of frames. Aborting the request errors the body, as a real fetch would. */
function sse(frames: Frame[], signal: AbortSignal | null | undefined, endless: boolean) {
  const encoder = new TextEncoder();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let at = 0;
      for (const [event, data, delay] of frames) {
        at += delay;
        timers.push(setTimeout(() => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)), at));
      }
      if (!endless) timers.push(setTimeout(() => controller.close(), at + 10));
      signal?.addEventListener("abort", () => {
        timers.forEach(clearTimeout);
        controller.error(new DOMException("Aborted", "AbortError"));
      });
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const stepFrames = (path: string, count: number): Frame[] => {
  const last = path.includes("picks") ? "submit_picks" : path.includes("sets") ? "submit_set" : null;
  const steps = STEPS.slice(0, count).map((s): Frame => ["tool", s, 1200]);
  return last && count >= STEPS.length ? [...steps, ["tool", { name: last, input: {} }, 1200]] : steps;
};

async function doneBody(path: string): Promise<unknown> {
  const real = <T>(p: string) => realFetch(p).then((r) => r.json() as Promise<T>);
  if (path === "/api/picks/generate") return real("/api/picks");
  if (path === "/api/ask") {
    const threads = await real<{ items: { id: number }[] }>("/api/ask/threads");
    return { threadId: threads.items[0]?.id ?? 1, answer: ANSWER };
  }
  const id = path.match(/^\/api\/sets\/(\d+)/)?.[1] ?? (await real<{ items: { id: number }[] }>("/api/sets")).items[0]?.id;
  return { set: await real(`/api/sets/${id}`), reply: null, changed: true };
}

const PAUSED_UNTIL = new Date(Date.now() + 2 * 3600_000).toISOString();

const RUN_ERRORS: Record<string, [number, Json]> = {
  budget: [402, { code: "llm_budget_exceeded", message: "Monthly LLM budget spent", details: { month: "2026-11", spentUsd: 100.04, capUsd: 100 } }],
  unconfigured: [503, { code: "llm_not_configured", message: "ANTHROPIC_API_KEY is not set" }],
  paused: [503, { code: "spotify_paused", message: "Spotify calls are paused", details: { reason: "rate_limited", until: PAUSED_UNTIL } }],
};

async function runFixture(path: string, method: string, signal: AbortSignal | null | undefined): Promise<Response | null> {
  if (path === "/api/status" && method === "GET") {
    const status = (await realFetch(path).then((r) => r.json())) as { llm: Json; spotify: Json };
    status.llm = { ...status.llm, configured: run !== "unconfigured" };
    if (run === "budget") status.llm = { ...status.llm, spentUsd: 100.04, capUsd: 100, remainingUsd: 0, exhausted: true };
    if (run === "paused") status.spotify = { ...status.spotify, paused: { reason: "rate_limited", until: PAUSED_UNTIL, since: new Date().toISOString() } };
    return json(status);
  }
  if (path === "/api/runs" && method === "GET")
    return json({ run: run === "running" ? { id: RUN_ID, startedAt: new Date(Date.now() - 74_000).toISOString() } : null });
  if (path === `/api/runs/${RUN_ID}/events`)
    return sse([["run", { id: RUN_ID, startedAt: new Date(Date.now() - 74_000).toISOString() }, 0], ...stepFrames("", 4)], signal, true);
  if (path === `/api/runs/${RUN_ID}` && method === "DELETE") return json({ cancelled: true });
  if (method !== "POST" || !RUN_PATHS.some((r) => r.test(path))) return null;
  const error = RUN_ERRORS[run!];
  if (error) return json({ error: error[1] }, error[0]);
  if (run === "starting") return new Promise<Response>(() => {});
  const opened: Frame = ["run", { id: RUN_ID, startedAt: new Date().toISOString() }, 0];
  if (run === "running") return sse([opened, ...stepFrames(path, STEPS.length)], signal, true);
  if (run === "failed")
    return sse(
      [opened, ...stepFrames(path, 3), ["error", { error: { code: "llm_failed", message: "The Anthropic API returned 529 overloaded" } }, 1200]],
      signal,
      false,
    );
  const text: Frame[] = path === "/api/ask" ? ANSWER.match(/.{1,24}/gs)!.map((delta): Frame => ["text", { delta }, 80]) : [];
  return sse([opened, ...stepFrames(path, STEPS.length), ...text, ["done", await doneBody(path), 600]], signal, false);
}

const LIVING_TARGET: Record<string, string> = { fresh: "most-played", deferred: "most-played", failed: "most-played", empty: "most-played", removed: "forgotten" };

/** One living playlist bent into the fixture's state. Detail fields (items, preview, history) are bent when present. */
function bendLiving(p: Json, state: string): Json {
  const kind = p.kind as string;
  const detail = "items" in p;
  if (state === "first") return { ...p, enabled: false, playlist: null, status: null, count: 0, changedAt: null, checkedAt: null, nextRefresh: null, ...(detail ? { preview: (p.items as Json[]).length ? p.items : p.preview, items: [], history: [] } : {}) };
  if (state === "empty" && kind === "this-month")
    return { ...p, enabled: true, status: "empty", count: 0, available: 0, ...(detail ? { items: [], preview: [], history: [] } : {}) };
  if (LIVING_TARGET[state] !== kind) return p;
  if (state === "fresh") return { ...p, enabled: true, playlist: null, status: null, count: 0, changedAt: null, checkedAt: null, ...(detail ? { preview: p.items, items: [], history: [] } : {}) };
  if (state === "deferred") return { ...p, status: "deferred" };
  if (state === "failed") return { ...p, status: "failed", error: "Spotify API 502: Bad gateway", attemptedAt: new Date().toISOString() };
  if (state === "empty") return { ...p, status: "empty", available: 0 };
  if (state === "removed")
    return {
      ...p,
      enabled: false,
      playlist: null,
      status: "removed",
      removedAt: "2026-11-12T08:30:00.000Z",
      nextRefresh: null,
      count: 0,
      changedAt: null,
      ...(detail ? { preview: (p.items as Json[]).length ? p.items : p.preview, items: [], history: (p.history as Json[]).map((h) => ({ ...h, current: false })) } : {}),
    };
  return p;
}

const LIVING_OUTCOME: Record<string, string> = { deferred: "deferred", failed: "failed", empty: "unchanged" };

async function livingAnswer(path: string, method: string, init: RequestInit | undefined): Promise<Response | null> {
  if (!livingFixture || !path.startsWith("/api/living")) return null;
  const state = livingFixture;
  const spotify = { connected: true, canWrite: state !== "scope", canUploadCovers: state !== "scope" };
  const write = path.match(/^\/api\/living\/([a-z-]+)(\/refresh)?$/);
  if (write && method !== "GET") {
    if (state === "refreshing") return new Promise<Response>(() => {});
    const body = (await (await realFetch(`/api/living/${write[1]}`)).json()) as Json;
    const enabled = write[2] ? true : (JSON.parse(String(init?.body ?? "{}")) as { enabled?: boolean }).enabled ?? true;
    const playlist = { ...bendLiving(body, state), enabled };
    return json({ outcome: { kind: write[1], status: enabled ? (LIVING_OUTCOME[state] ?? "refreshed") : "off", calls: 2 }, playlist });
  }
  if (method !== "GET" || path.endsWith("/cover") || path.includes("/refreshes/")) return null;
  if (fixture) return null;
  const res = await realFetch(path);
  if (!res.ok) return res;
  const body = (await res.json()) as Json;
  if (path === "/api/living") return json({ spotify, items: (body.items as Json[]).map((p) => bendLiving(p, state)) });
  return json(bendLiving(body, state));
}

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
  if (dj === "active") {
    if (path === "/api/dj" && method === "GET") return json({ session: await djSession() });
    if ((path === "/api/dj/start" || /^\/api\/sets\/\d+\/play$/.test(path)) && method === "POST") return json({ session: await djSession() });
    if (path === "/api/dj/stop" && method === "POST") return json({ stopped: true });
  }
  if (run) {
    const answer = await runFixture(path, method, init?.signal);
    if (answer) return answer;
  }
  if (settingsFixture) {
    const answer = await settingsFixtureAnswer(path, method);
    if (answer) return answer;
  }
  if (historyFixture) {
    const answer = await historyFixtureAnswer(path, method, init);
    if (answer) return answer;
  }
  if (livingFixture) {
    const answer = await livingAnswer(path, method, init);
    if (answer) return answer;
  }
  if (!fixture || method !== "GET") return realFetch(input, init);
  if (path === "/api/status" || path === "/api/player/now" || path === "/api/player/queue") return realFetch(input, init);

  if (fixture === "loading") return new Promise<Response>(() => {});
  if (fixture === "error") return json({ error: { code: "internal", message: "The database is locked by another process." } }, 500);
  const lifetime = path === "/api/stats/overview" && !url.searchParams.has("from") && !url.searchParams.has("to");
  if (fixture === "empty" && lifetime) return realFetch(input, init);
  if (fixture === "empty" || fixture === "new") {
    if (path.startsWith("/api/entities/")) return json({ error: { code: "not_found", message: "No music plays in this range." } }, 404);
    if (fixture === "new" && path === "/api/onboarding") {
      const body = (await (await realFetch(input, init)).json()) as { steps: Record<string, Json> };
      return json({ ...body, complete: false, steps: { ...body.steps, import: { ...body.steps.import, done: false, plays: 0, exportPlays: 0, lastImportAt: null } } });
    }
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
