import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { PLAY_OUTCOMES } from "../analytics/common";
import { decades } from "../analytics/decades";
import { comebacks, discovery, loyalty, monthDiscoveries } from "../analytics/discovery";
import { artistPage, albumPage, trackPage } from "../analytics/entities";
import { history } from "../analytics/history";
import { overview } from "../analytics/overview";
import { podcasts } from "../analytics/podcasts";
import { milestones, records, streaks } from "../analytics/records";
import { forgotten, onThisDay } from "../analytics/recall";
import { search } from "../analytics/search";
import { topAlbums, topArtists, topTracks } from "../analytics/top";
import { listeningYears, yearCompare } from "../analytics/years";
import type { Db } from "../db/client";
import { MissingScopeError } from "../living/refresh";
import { NoActiveDeviceError, PremiumRequiredError } from "../player/api";
import { localTime } from "../plays/localTime";
import { listReleases, markReleasesSeen } from "../radar/radar";
import type { Services } from "../services";
import type { SettingsSource } from "../settings/settings";
import type { SpotifyClient } from "../spotify/client";
import { SpotifyApiError, SpotifyBlockedError, SpotifyNotConfiguredError, SpotifyNotConnectedError } from "../spotify/errors";
import { addToPlaylist, createPlaylist, PlaylistTracksError, playlistIdOf, trackUris } from "./playlists";

/** What each tool can do, for the OAuth consent page. A test keeps it in step with the registered tools. */
export const MCP_TOOLS = {
  read: [
    "overview",
    "top",
    "history",
    "lookup",
    "on_this_day",
    "forgotten",
    "discovery",
    "comebacks",
    "loyalty",
    "records",
    "decades",
    "year_compare",
    "podcasts",
    "now_playing",
    "releases",
    "devices",
  ],
  playback: ["play", "add_to_queue", "pause", "resume", "skip_next", "skip_previous"],
  write: ["create_playlist", "add_to_playlist", "mark_release_seen"],
} as const;

export type McpDeps = { db: Db; settings: SettingsSource; services: Services; spotify: SpotifyClient; now: () => number };

const PLAYLIST_SCOPES = ["playlist-modify-private", "playlist-modify-public"];
const CONTROL_SCOPES = ["user-modify-playback-state"];
const DEVICE_SCOPES = ["user-read-playback-state"];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD, local time");
const range = { from: day.optional(), to: day.optional() };
const trackUri = z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/);

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const failure = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
const deviceId = z.string().min(1).max(100).optional().describe("A device id from the devices tool; default is the active device");
const trackRefs = z
  .array(z.union([z.string(), z.object({ uri: z.string().nullable().optional() }).passthrough()]))
  .max(500)
  .describe("Track ids, spotify:track URIs, open.spotify.com track links, or song objects with a uri (the items forgotten, top or history return)");

const reauthorize = (scopes: string) => `Re-authorize Encore to grant ${scopes}: connect Spotify again in encore Settings.`;

/** What the person can do about a failed Spotify action, or null for an error that is not theirs to fix. */
function spotifyFailure(error: unknown): string | null {
  if (error instanceof MissingScopeError) return reauthorize(error.scope);
  if (error instanceof NoActiveDeviceError) return "No active Spotify device. Open Spotify on a phone, computer or speaker and play something there, or pass device_id from the devices tool.";
  if (error instanceof PremiumRequiredError) return "Spotify Premium is required to control playback.";
  if (error instanceof SpotifyNotConnectedError || error instanceof SpotifyNotConfiguredError) return "Spotify is not connected. Connect it in encore Settings.";
  if (error instanceof SpotifyBlockedError) return `Spotify asked encore to pause its calls until ${new Date(error.blockedUntil).toISOString()}. Try again after that.`;
  if (error instanceof SpotifyApiError && error.status === 403 && /scope/i.test(error.message)) return reauthorize("the missing Spotify permission");
  return null;
}

export function createEncoreMcpServer({ db, settings, services, spotify, now }: McpDeps): McpServer {
  const server = new McpServer({ name: "encore", version: "1.0.0" });

  async function spotifyAction(scopes: string[], action: () => Promise<unknown>) {
    const missing = scopes.filter((scope) => !spotify.hasScope(scope));
    if (missing.length) return failure(reauthorize(missing.join(" and ")));
    try {
      return json(await action());
    } catch (error) {
      if (error instanceof PlaylistTracksError) {
        const cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
        return failure(`${error.message}: ${spotifyFailure(error.cause) ?? cause}`);
      }
      const text = spotifyFailure(error);
      if (text === null) throw error;
      return failure(text);
    }
  }

  server.registerTool(
    "overview",
    { description: "Listening totals for a local date range: hours, plays, listens, unique songs and artists, skip rate, top artist and song.", inputSchema: z.object(range) },
    async ({ from, to }) => json(overview(db, { range: { from, to } })),
  );

  server.registerTool(
    "top",
    {
      description: "Top artists, songs or albums in a local date range, sorted by hours, listens or plays.",
      inputSchema: z.object({ ...range, kind: z.enum(["artists", "songs", "albums"]), sort: z.enum(["hours", "listens", "plays"]).default("hours"), limit: z.number().int().min(1).max(100).default(20) }),
    },
    async ({ kind, sort, limit, from, to }) => {
      const params = { range: { from, to }, sort, limit };
      return json(kind === "artists" ? topArtists(db, params) : kind === "songs" ? topTracks(db, params) : topAlbums(db, params));
    },
  );

  server.registerTool(
    "history",
    {
      description:
        "Individual plays, newest first. Filter by date range, artist, song key, track URI, outcome or text. Each song play has an outcome: through (it ended or was left in its outro: the last 20% or last 30 seconds), early (next pressed in the first 30 seconds), midway (next pressed later), interrupted (back, another song chosen, app closed, error: not a skip), or null when unknown. A skip is not a dislike.",
      inputSchema: z.object({
        ...range,
        artist: z.string().min(1).optional(),
        songKey: z.string().min(1).optional(),
        uri: trackUri.optional(),
        outcomes: z.array(z.enum(PLAY_OUTCOMES)).optional(),
        q: z.string().min(1).max(200).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    },
    async ({ from, to, ...filters }) => json(history(db, { ...filters, range: { from, to } })),
  );

  server.registerTool(
    "lookup",
    {
      description: "Find artists, songs and albums by name, or get the full page of one artist, album or song (stats, timeline, skip profile).",
      inputSchema: z.object({
        query: z.string().min(1).max(200).optional().describe("Name search across artists, songs and albums"),
        artist: z.string().min(1).optional(),
        album: z.string().min(1).optional().describe("With artist: the album page"),
        songKey: z.string().min(1).optional(),
        uri: trackUri.optional(),
      }),
    },
    async ({ query, artist, album, songKey, uri }) => {
      const page = { range: {}, period: "month" as const, weekendDays: settings.get().weekendDays };
      if (songKey || uri) return json(trackPage(db, { ...page, songKey, uri }));
      if (artist && album) return json(albumPage(db, { ...page, artist, album }));
      if (artist) return json(artistPage(db, { ...page, artist }));
      return json(search(db, { q: query ?? "", limit: 10 }));
    },
  );

  server.registerTool(
    "on_this_day",
    { description: "What was played on this month-day in earlier years.", inputSchema: z.object({ date: day.optional(), limit: z.number().int().min(1).max(20).default(5) }) },
    async ({ date, limit }) => json(onThisDay(db, { date: date ?? localTime(now(), settings.get().timezone).day, limit })),
  );

  server.registerTool(
    "forgotten",
    {
      description: "Songs listened to often that have not been played for a while.",
      inputSchema: z.object({ days: z.number().int().min(1).max(3650).default(90), minListens: z.number().int().min(1).default(10), limit: z.number().int().min(1).max(100).default(20) }),
    },
    async (args) => json(forgotten(db, { ...args, asOf: now() })),
  );

  server.registerTool(
    "discovery",
    {
      description:
        "New artists and songs per month (first played that month, all time) and the share of each month's hours on songs first heard that month. With month (YYYY-MM): that month's new artists and songs instead.",
      inputSchema: z.object({ ...range, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), limit: z.number().int().min(1).max(50).default(20) }),
    },
    async ({ from, to, month, limit }) => json(month ? monthDiscoveries(db, { month, limit }) : discovery(db, { range: { from, to } })),
  );

  server.registerTool(
    "comebacks",
    {
      description:
        "Artists played a lot (3+ hours), then barely (under 15 minutes a month) for 6+ months in which other music was played, then back (1+ hour since). Listed by the day they came back, which the date range filters.",
      inputSchema: z.object({ ...range, limit: z.number().int().min(1).max(50).default(20) }),
    },
    async ({ from, to, limit }) => json(comebacks(db, { range: { from, to }, limit })),
  );

  server.registerTool(
    "loyalty",
    {
      description: "Artists played 2+ hours in each of many calendar years, with their longest run of consecutive such years.",
      inputSchema: z.object({ ...range, limit: z.number().int().min(1).max(50).default(20) }),
    },
    async ({ from, to, limit }) => json(loyalty(db, { range: { from, to }, limit })),
  );

  server.registerTool(
    "records",
    {
      description:
        "Personal records in a date range: most hours in a day, a week and a month, most listens of one song in a day, the longest session (plays less than 15 minutes apart), days in a row with listening (current and longest) and artists' longest daily runs, and milestones crossed (a song's 10th, 25th... listen, an artist's 10th, 50th... hour, total hours).",
      inputSchema: z.object({ ...range }),
    },
    async ({ from, to }) => {
      const today = localTime(now(), settings.get().timezone).day;
      return json({ ...records(db, { range: { from, to } }), streaks: streaks(db, { range: { from, to }, today }), milestones: milestones(db, { range: { from, to }, limit: 20 }).items });
    },
  );

  server.registerTool(
    "decades",
    {
      description: "Hours by the release decade of the songs played, and the listening age: the median release year weighted by hours. Songs without a release date are left out; coverage says how much.",
      inputSchema: z.object(range),
    },
    async ({ from, to }) => json(decades(db, { range: { from, to } })),
  );

  server.registerTool(
    "year_compare",
    {
      description: "Two calendar years side by side: hours, plays, new artists and songs, top artists with their rank in each year, genre and mood shares. Default: the latest year with plays against the one before.",
      inputSchema: z.object({ a: z.number().int().min(1900).max(2999).optional(), b: z.number().int().min(1900).max(2999).optional() }),
    },
    async ({ a, b }) => {
      const later = b ?? listeningYears(db).at(-1) ?? Number(localTime(now(), settings.get().timezone).day.slice(0, 4));
      return json(yearCompare(db, { a: a ?? later - 1, b: later }));
    },
  );

  server.registerTool(
    "podcasts",
    { description: "Podcast listening: hours by show and the latest episodes.", inputSchema: z.object({ ...range, limit: z.number().int().min(1).max(50).default(20) }) },
    async ({ from, to, limit }) => json(podcasts(db, { range: { from, to }, limit })),
  );

  server.registerTool("now_playing", { description: "What is playing on Spotify right now." }, async () => json(await services.watcher.nowPlaying(settings.get().watcherIdleMs + 5000)));

  server.registerTool(
    "releases",
    {
      description:
        "Releases found by the release radar: new ones, or all from the last N days. Leaves out releases marked seen and re-releases (remasters, live recordings, anniversary and deluxe editions, re-recordings, compilations) unless asked.",
      inputSchema: z.object({
        status: z.enum(["new", "recent"]).default("new"),
        days: z.number().int().min(1).max(365).default(30),
        includeSeen: z.boolean().default(false),
        includeReissues: z.boolean().default(false),
      }),
    },
    async ({ status, days, includeSeen, includeReissues }) => {
      const since = new Date(now() - days * 86_400_000).toISOString().slice(0, 10);
      return json(listReleases(db, { status, since, limit: 50, includeSeen, includeReissues }));
    },
  );

  server.registerTool(
    "mark_release_seen",
    {
      description: "Mark release radar items as seen, so releases no longer lists them. Pass ids (from releases), or all: true for every unseen release.",
      inputSchema: z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(500).optional().describe("Release ids, spotify:album URIs or album links"), all: z.boolean().optional() }),
    },
    async ({ ids, all }) => {
      if (Boolean(ids) === Boolean(all)) return failure("Pass either ids or all: true.");
      const target = ids ? ids.map((id) => id.trim().match(/([A-Za-z0-9]{22})(?:[/?#].*)?$/)?.[1] ?? id) : "all";
      return json({ marked: markReleasesSeen(db, target, now()) });
    },
  );

  server.registerTool(
    "create_playlist",
    {
      description: "Create a Spotify playlist, private unless public is true, optionally with tracks. Returns its id and URL.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().max(300).default(""),
        public: z.boolean().default(false),
        tracks: trackRefs.default([]),
      }),
    },
    async ({ name, description, public: isPublic, tracks }) => {
      const { uris, invalid } = trackUris(tracks);
      if (invalid.length) return failure(`Not Spotify tracks: ${invalid.slice(0, 5).join(", ")}`);
      return spotifyAction(PLAYLIST_SCOPES, () => createPlaylist(spotify, { name, description, public: isPublic, uris }));
    },
  );

  server.registerTool(
    "add_to_playlist",
    {
      description: "Add tracks to a Spotify playlist you own or collaborate on. Repeated tracks and tracks already in the playlist are skipped.",
      inputSchema: z.object({ playlist: z.string().min(1).max(200).describe("Playlist id, spotify:playlist URI or link"), tracks: trackRefs.min(1) }),
    },
    async ({ playlist, tracks }) => {
      const playlistId = playlistIdOf(playlist);
      if (!playlistId) return failure(`Not a Spotify playlist: ${playlist}`);
      const { uris, invalid } = trackUris(tracks);
      if (invalid.length) return failure(`Not Spotify tracks: ${invalid.slice(0, 5).join(", ")}`);
      return spotifyAction(PLAYLIST_SCOPES, () => addToPlaylist(spotify, playlistId, uris));
    },
  );

  server.registerTool(
    "play",
    { description: "Start playing one or more tracks on the active Spotify device. Replaces what is playing.", inputSchema: z.object({ uris: z.array(trackUri).min(1).max(50) }) },
    async ({ uris }) => spotifyAction(CONTROL_SCOPES, () => services.player.play({ uris }).then(() => ({ ok: true }))),
  );

  server.registerTool(
    "add_to_queue",
    { description: "Add a track to the Spotify playback queue.", inputSchema: z.object({ uri: trackUri }) },
    async ({ uri }) => spotifyAction(CONTROL_SCOPES, () => services.player.addToQueue(uri).then(() => ({ ok: true }))),
  );

  const controls = [
    ["pause", "Pause Spotify playback.", (id?: string) => services.player.pause(id)],
    ["resume", "Resume Spotify playback where it was paused.", (id?: string) => services.player.resume(id)],
    ["skip_next", "Skip to the next track.", (id?: string) => services.player.next(id)],
    ["skip_previous", "Go back to the previous track.", (id?: string) => services.player.previous(id)],
  ] as const;
  for (const [name, description, command] of controls) {
    server.registerTool(name, { description, inputSchema: z.object({ device_id: deviceId }) }, async ({ device_id }) =>
      spotifyAction(CONTROL_SCOPES, () => command(device_id).then(() => ({ ok: true }))),
    );
  }

  server.registerTool("devices", { description: "Spotify devices available for playback, and which one is active." }, async () =>
    spotifyAction(DEVICE_SCOPES, async () => ({
      devices: (await services.player.devices()).map((d) => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, restricted: d.is_restricted, volume: d.volume_percent })),
    })),
  );

  return server;
}

export function createMcpEndpoint(deps: McpDeps) {
  return createMcpHandler(() => createEncoreMcpServer(deps));
}
