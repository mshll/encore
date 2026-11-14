import { sql } from "drizzle-orm";
import { z } from "zod";
import { musicWhere, songStatsSql, type SongRow } from "../analytics/common";
import type { Db } from "../db/client";
import { tool, ToolError, type AgentTool } from "../llm/agent";
import { SpotifyBlockedError, SpotifyNotConnectedError, SpotifyApiError } from "../spotify/errors";
import { GENRES, MOODS } from "../tags/vocabulary";
import { artistKey, isBlocked, type Blocked } from "./blocks";
import { SearchLimitError, type CandidateVerifier } from "./candidates";
import { loadCatalog, type CatalogSong, type ContextCounts, type DayType, type HourBucket } from "./catalog";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const HOUR_BUCKETS = ["night", "morning", "afternoon", "evening"] as const;
const CLASSES = ["keeper", "wrong_moment", "dislike", "mixed", "unclassified"] as const;

export const findSongsInput = z.strictObject({
  artists: z.array(z.string()).optional().describe("Exact artist names (case-insensitive)."),
  text: z.string().optional().describe("Case-insensitive substring of song, artist or album name."),
  genres: z.array(z.enum(GENRES)).optional().describe("Match songs tagged with any of these genres."),
  moods: z.array(z.enum(MOODS)).optional().describe("Match songs tagged with any of these moods."),
  energyMin: z.number().int().min(1).max(5).optional(),
  energyMax: z.number().int().min(1).max(5).optional(),
  valenceMin: z.number().int().min(1).max(5).optional(),
  valenceMax: z.number().int().min(1).max(5).optional(),
  language: z.string().optional().describe("ISO 639-1 code or 'instrumental'."),
  playedFrom: day.optional().describe("Only songs listened to on or after this local day (YYYY-MM-DD); stats then cover this window."),
  playedTo: day.optional().describe("Only songs listened to on or before this local day; stats then cover this window."),
  classes: z.array(z.enum(CLASSES)).optional().describe("Moment classes; 'unclassified' means fewer than 8 plays with skip data."),
  maxSkipRate: z.number().min(0).max(1).optional(),
  minListens: z.number().int().min(0).optional(),
  notPlayedForDays: z.number().int().min(1).optional().describe("Only songs not played in the last N days."),
  hourBucket: z.enum(HOUR_BUCKETS).optional().describe("Report and sort by skip rate in this time of day: night 00-05, morning 06-11, afternoon 12-17, evening 18-23."),
  dayType: z.enum(["weekday", "weekend"]).optional().describe("Report and sort by skip rate on weekdays or weekends (Friday and Saturday)."),
  sort: z.enum(["listens", "recent", "least_recent", "context_fit", "lowest_skip_rate"]).optional(),
  limit: z.number().int().min(1).max(40).optional(),
});

type FindSongsInput = z.infer<typeof findSongsInput>;

const rate = (c: ContextCounts | undefined) => (c && c.plays >= 3 ? Math.round((c.skips / c.plays) * 100) / 100 : null);
const iso = (ts: number) => new Date(ts).toISOString().slice(0, 10);

function windowStats(db: Db, from: string | undefined, to: string | undefined) {
  const rows = db.all<SongRow>(songStatsSql(musicWhere({ from, to })));
  return new Map(rows.map((r) => [r.song_key, r]));
}

export function findSongs(db: Db, blocked: Blocked, input: FindSongsInput, now: number) {
  const catalog = loadCatalog(db);
  const window = input.playedFrom || input.playedTo ? windowStats(db, input.playedFrom, input.playedTo) : null;
  const artists = input.artists?.map(artistKey);
  const text = input.text?.toLowerCase();
  const cutoff = input.notPlayedForDays ? now - input.notPlayedForDays * 86_400_000 : null;
  const contextRate = (s: CatalogSong) => {
    const rates = [input.hourBucket && rate(s.hourBucket[input.hourBucket as HourBucket]), input.dayType && rate(s.dayType[input.dayType as DayType])].filter(
      (r): r is number => typeof r === "number",
    );
    return rates.length ? Math.max(...rates) : null;
  };
  const matches = [...catalog.songs.values()].filter((s) => {
    if (isBlocked(blocked, s.songKey, [s.artist])) return false;
    if (window && !window.get(s.songKey)?.listens) return false;
    if (artists && !artists.includes(artistKey(s.artist))) return false;
    if (text && ![s.name, s.artist, s.album ?? ""].some((v) => v.toLowerCase().includes(text))) return false;
    const t = s.tags;
    if ((input.genres || input.moods || input.language || input.energyMin || input.energyMax || input.valenceMin || input.valenceMax) && !t) return false;
    if (t) {
      if (input.genres && !input.genres.some((g) => t.genres.includes(g))) return false;
      if (input.moods && !input.moods.some((m) => t.moods.includes(m))) return false;
      if (input.language && t.language !== input.language) return false;
      if (input.energyMin && t.energy < input.energyMin) return false;
      if (input.energyMax && t.energy > input.energyMax) return false;
      if (input.valenceMin && t.valence < input.valenceMin) return false;
      if (input.valenceMax && t.valence > input.valenceMax) return false;
    }
    if (input.classes && !input.classes.includes(s.class ?? "unclassified")) return false;
    if (input.maxSkipRate !== undefined && s.skipRate !== null && s.skipRate > input.maxSkipRate) return false;
    if (input.minListens !== undefined && (window?.get(s.songKey)?.listens ?? s.listens) < input.minListens) return false;
    if (cutoff !== null && s.lastPlayed >= cutoff) return false;
    return true;
  });
  const listens = (s: CatalogSong) => window?.get(s.songKey)?.listens ?? s.listens;
  const sorters: Record<string, (a: CatalogSong, b: CatalogSong) => number> = {
    listens: (a, b) => listens(b) - listens(a),
    recent: (a, b) => b.lastPlayed - a.lastPlayed,
    least_recent: (a, b) => a.lastPlayed - b.lastPlayed,
    lowest_skip_rate: (a, b) => (a.skipRate ?? 1) - (b.skipRate ?? 1) || listens(b) - listens(a),
    context_fit: (a, b) => (contextRate(a) ?? 0.5) - (contextRate(b) ?? 0.5) || listens(b) - listens(a),
  };
  const sort = input.sort ?? (input.hourBucket || input.dayType ? "context_fit" : "listens");
  matches.sort((a, b) => sorters[sort]!(a, b) || a.songKey.localeCompare(b.songKey));
  return {
    matched: matches.length,
    songs: matches.slice(0, input.limit ?? 25).map((s) => ({
      songKey: s.songKey,
      name: s.name,
      artist: s.artist,
      album: s.album,
      listens: listens(s),
      ...(window ? { listensAllTime: s.listens } : {}),
      skipRate: s.skipRate,
      class: s.class,
      ...(input.hourBucket || input.dayType ? { contextSkipRate: contextRate(s) } : {}),
      firstPlayed: iso(s.firstPlayed),
      lastPlayed: iso(s.lastPlayed),
      tags: s.tags && { genres: s.tags.genres, subgenre: s.tags.subgenre, moods: s.tags.moods, energy: s.tags.energy, valence: s.tags.valence, language: s.tags.language },
    })),
  };
}

export function artistProfile(db: Db, name: string) {
  const songs = [...loadCatalog(db).songs.values()].filter((s) => artistKey(s.artist) === artistKey(name));
  if (songs.length === 0) {
    const similar = db.all<{ artist: string }>(sql`select distinct artist from tracks where artist like ${`%${name.replace(/[\\%_]/g, "")}%`} limit 5`);
    return { known: false, suggestions: similar.map((r) => r.artist) };
  }
  const by = <K extends string>(pick: (s: CatalogSong) => K[]) => {
    const counts = new Map<K, number>();
    for (const s of songs) for (const k of pick(s)) counts.set(k, (counts.get(k) ?? 0) + s.listens);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  };
  const known = songs.reduce((n, s) => n + (s.skipRate !== null ? 1 : 0), 0);
  return {
    known: true,
    artist: songs[0]!.artist,
    songs: songs.length,
    listens: songs.reduce((n, s) => n + s.listens, 0),
    hours: Math.round(songs.reduce((n, s) => n + s.hours, 0) * 10) / 10,
    meanSkipRate: known ? Math.round((songs.reduce((n, s) => n + (s.skipRate ?? 0), 0) / known) * 100) / 100 : null,
    firstPlayed: iso(Math.min(...songs.map((s) => s.firstPlayed))),
    lastPlayed: iso(Math.max(...songs.map((s) => s.lastPlayed))),
    topGenres: by((s) => (s.tags?.genres ?? []) as string[]),
    topMoods: by((s) => (s.tags?.moods ?? []) as string[]),
    topSongs: songs
      .sort((a, b) => b.listens - a.listens)
      .slice(0, 12)
      .map((s) => ({ songKey: s.songKey, name: s.name, album: s.album, listens: s.listens, skipRate: s.skipRate, class: s.class })),
  };
}

export function libraryTools(db: Db, blocked: Blocked, now: number): AgentTool[] {
  return [
    tool({
      name: "find_songs",
      description:
        "Search the owner's own listening history (songs they have played). Use it to find songs that fit a request by tags, artist, era, moment class or time-of-day fit, and to check what the owner already knows. Filters combine with AND. Returns at most 40 songs plus the total match count.",
      schema: findSongsInput,
      run: (input) => findSongs(db, blocked, input, now),
    }),
    tool({
      name: "artist_profile",
      description: "Summarise how the owner listens to one artist: songs played, listens, hours, skip rate, first and last play, top songs. Use it before leaning on an artist.",
      schema: z.strictObject({ artist: z.string().min(1) }),
      run: ({ artist }) => artistProfile(db, artist),
    }),
  ];
}

export function verifyTool(verifier: CandidateVerifier): AgentTool {
  return tool({
    strict: true,
    name: "verify_new_song",
    description:
      "Check that a song exists on Spotify with an exact title and artist match and whether the owner has ever played it. Call it for every song you want to suggest that is not from find_songs. Live, remix, karaoke, acoustic and similar variants are rejected unless allowVariant is true; set it only when the owner asked for such a version. Only songs this tool returns as ok can be suggested.",
    schema: z.strictObject({
      title: z.string().min(1).describe("Song title only, without featured artists."),
      artist: z.string().min(1).describe("Primary artist."),
      allowVariant: z.boolean().optional(),
    }),
    run: async ({ title, artist, allowVariant }) => {
      try {
        const result = await verifier.verify(title, artist, allowVariant ?? false);
        if (!result.ok) return result;
        const { songKey: _key, ...song } = result.song;
        return { ok: true, song };
      } catch (error) {
        if (error instanceof SearchLimitError || error instanceof SpotifyBlockedError || error instanceof SpotifyNotConnectedError || error instanceof SpotifyApiError) {
          throw new ToolError(`Spotify lookup unavailable: ${error.message}`);
        }
        throw error;
      }
    },
  });
}
