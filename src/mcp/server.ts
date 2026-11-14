import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { artistPage, albumPage, trackPage } from "../analytics/entities";
import { history } from "../analytics/history";
import { overview } from "../analytics/overview";
import { forgotten, onThisDay } from "../analytics/recall";
import { search } from "../analytics/search";
import { topAlbums, topArtists, topTracks } from "../analytics/top";
import type { Db } from "../db/client";
import { localTime } from "../plays/localTime";
import { listReleases } from "../radar/radar";
import type { Services } from "../services";
import type { SettingsSource } from "../settings/settings";

export type McpDeps = { db: Db; settings: SettingsSource; services: Services; now: () => number };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD, local time");
const range = { from: day.optional(), to: day.optional() };
const trackUri = z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/);

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

export function createEncoreMcpServer({ db, settings, services, now }: McpDeps): McpServer {
  const server = new McpServer({ name: "encore", version: "1.0.0" });

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
      description: "Individual plays, newest first. Filter by date range, artist, song key, track URI, skipped flag or text.",
      inputSchema: z.object({
        ...range,
        artist: z.string().min(1).optional(),
        songKey: z.string().min(1).optional(),
        uri: trackUri.optional(),
        skipped: z.boolean().optional(),
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
      const page = { range: {}, period: "month" as const };
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

  server.registerTool("now_playing", { description: "What is playing on Spotify right now." }, async () => json(await services.watcher.nowPlaying(settings.get().watcherIdleMs + 5000)));

  server.registerTool(
    "releases",
    { description: "Releases found by the release radar: unseen new ones, or all from the last N days.", inputSchema: z.object({ status: z.enum(["new", "recent"]).default("new"), days: z.number().int().min(1).max(365).default(30) }) },
    async ({ status, days }) => {
      const since = new Date(now() - days * 86_400_000).toISOString().slice(0, 10);
      return json(listReleases(db, { status, since, limit: 50 }));
    },
  );

  server.registerTool(
    "play",
    { description: "Start playing one or more tracks on the active Spotify device. Replaces what is playing.", inputSchema: z.object({ uris: z.array(trackUri).min(1).max(50) }) },
    async ({ uris }) => {
      await services.player.play({ uris });
      return json({ ok: true });
    },
  );

  server.registerTool(
    "add_to_queue",
    { description: "Add a track to the Spotify playback queue.", inputSchema: z.object({ uri: trackUri }) },
    async ({ uri }) => {
      await services.player.addToQueue(uri);
      return json({ ok: true });
    },
  );

  return server;
}

export function createMcpEndpoint(deps: McpDeps) {
  return createMcpHandler(() => createEncoreMcpServer(deps));
}
