import { z } from "zod";
import { artistPage, trackPage } from "../analytics/entities";
import { overview } from "../analytics/overview";
import { forgotten, onThisDay } from "../analytics/recall";
import { search } from "../analytics/search";
import { MOMENT_CLASSES, momentSplit } from "../analytics/skips";
import { energyByHour, genreSeries, moodSeries } from "../analytics/tags";
import { eras, topAlbums, topArtists, topTracks } from "../analytics/top";
import { trips } from "../analytics/trips";
import type { Db } from "../db/client";
import { tool, ToolError, type AgentTool } from "../llm/agent";
import { queryPlays, queryPlaysInput } from "./query";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = { from: day.optional().describe("First local day, inclusive."), to: day.optional().describe("Last local day, inclusive.") };
const period = z.enum(["day", "week", "month", "year"]).optional();

function checkRange(r: { from?: string; to?: string }) {
  if (r.from && r.to && r.from > r.to) throw new ToolError("from must be on or before to");
  return { from: r.from, to: r.to };
}

const songBrief = (s: { songKey: string; name: string; artist: string; album: string | null; hours: number; plays: number; listens: number; skipRate: number | null; firstPlayed: string | null; lastPlayed: string | null }) => ({
  songKey: s.songKey,
  name: s.name,
  artist: s.artist,
  album: s.album,
  hours: s.hours,
  plays: s.plays,
  listens: s.listens,
  skipRate: s.skipRate,
  firstPlayed: s.firstPlayed?.slice(0, 10),
  lastPlayed: s.lastPlayed?.slice(0, 10),
});

/** Read-only tools over the play history. None of them reaches auth, session, passkey, token or ledger tables. */
export function askTools(db: Db, { homeCountry, weekendDays }: { homeCountry?: string; weekendDays: readonly number[] }, now: number): AgentTool[] {
  return [
    tool({
      name: "query_plays",
      description:
        "Flexible aggregate over music plays: filter, group by up to three keys, and choose metrics. Use it for any count, trend or comparison the other tools don't answer directly. Listens = plays of 30 s or more (all API rows count). hours = time played. skipRate covers export and live rows (API rows have no skip flag). All days and hours are local time.",
      schema: queryPlaysInput,
      run: (input) => queryPlays(db, { ...input, ...checkRange(input) }, weekendDays),
    }),
    tool({
      name: "overview",
      description: "Totals for a period: hours, plays, listens, unique songs and artists, skip and shuffle rate, top artist and song.",
      schema: z.strictObject(range),
      run: (input) => overview(db, { range: checkRange(input) }),
    }),
    tool({
      name: "top",
      description: "Top artists, songs or albums for a period, sorted by hours, listens or plays. Artists and songs can be narrowed to one weekday and/or hour.",
      schema: z.strictObject({
        kind: z.enum(["artists", "songs", "albums"]),
        ...range,
        sort: z.enum(["hours", "listens", "plays"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        weekday: z.number().int().min(1).max(7).optional(),
        hour: z.number().int().min(0).max(23).optional(),
      }),
      run: ({ kind, sort, limit = 15, weekday, hour, ...r }) => {
        const params = { range: checkRange(r), limit, sort };
        if (kind === "artists") return topArtists(db, { ...params, weekday, hour });
        if (kind === "songs") return topTracks(db, { ...params, weekday, hour }).map(songBrief);
        return topAlbums(db, params).map(({ albumArtUrl: _art, ...a }) => a);
      },
    }),
    tool({
      name: "artist_history",
      description: "One artist over time: totals, a timeline by period, skip profile by context, top songs and albums.",
      schema: z.strictObject({ artist: z.string().min(1), ...range, period }),
      run: ({ artist, period: p, ...r }) => {
        const page = artistPage(db, { artist, range: checkRange(r), period: p ?? "month", weekendDays });
        if (!page) return { found: false, hint: "No plays for that exact artist name in this range. Use search_library to find the exact name." };
        return { ...page, tracks: page.tracks.slice(0, 15).map(songBrief), albums: page.albums.slice(0, 10).map(({ albumArtUrl: _art, ...a }) => a) };
      },
    }),
    tool({
      name: "song_history",
      description: "One song (by songKey from another tool) over time: totals, timeline, skip profile by context, and its moment class.",
      schema: z.strictObject({ songKey: z.string().min(1), ...range, period }),
      run: ({ songKey, period: p, ...r }) => {
        const page = trackPage(db, { songKey, range: checkRange(r), period: p ?? "month", weekendDays });
        if (!page) return { found: false };
        const { albumArtUrl: _art, ...rest } = page;
        return rest;
      },
    }),
    tool({
      name: "search_library",
      description: "Find exact artist, song and album names in the history by substring. Use it before the other tools when a name may be spelled differently.",
      schema: z.strictObject({ q: z.string().min(1).max(100), limit: z.number().int().min(1).max(20).optional() }),
      run: ({ q, limit }) => {
        const r = search(db, { q, limit: limit ?? 8 });
        return { artists: r.artists, songs: r.songs.map(songBrief), albums: r.albums.map(({ albumArtUrl: _art, ...a }) => a) };
      },
    }),
    tool({
      name: "skip_split",
      description:
        "Classify songs with 8+ plays with a known outcome as keeper, wrong_moment (played through in some contexts, skipped in others), skipped_everywhere or mixed. A skip is next pressed before the song's outro; leaving in the outro counts as played through, and going back or choosing another song is no skip. A skip is not a dislike, not even skipped_everywhere; use this before saying the owner avoids a song. Name a class to the owner in plain words, never by its id.",
      schema: z.strictObject({ ...range, class: z.enum(MOMENT_CLASSES).optional(), limit: z.number().int().min(1).max(50).optional() }),
      run: ({ class: only, limit, ...r }) => {
        const split = momentSplit(db, { range: checkRange(r), minPlays: 8, minContextPlays: 5, limit: limit ?? 20, only, weekendDays });
        return { ...split, songs: split.songs.map((s) => ({ ...songBrief(s), class: s.class, bestContext: s.bestContext, worstContext: s.worstContext })) };
      },
    }),
    tool({
      name: "forgotten",
      description: "Songs the owner played a lot (all time) but not in the last N days.",
      schema: z.strictObject({ days: z.number().int().min(1).max(3650), minListens: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(50).optional() }),
      run: ({ days, minListens, limit }) => {
        const r = forgotten(db, { days, minListens: minListens ?? 10, limit: limit ?? 20, asOf: now });
        return { ...r, items: r.items.map(songBrief) };
      },
    }),
    tool({
      name: "on_this_day",
      description: "What the owner played on the same month and day in earlier years.",
      schema: z.strictObject({ date: day }),
      run: ({ date }) => {
        const r = onThisDay(db, { date, limit: 5 });
        return { ...r, years: r.years.map((y) => ({ ...y, topTracks: y.topTracks.map(songBrief) })) };
      },
    }),
    tool({
      name: "eras",
      description: "Top artists by hours for a period with hours per month, peak month, and first and last play.",
      schema: z.strictObject({ ...range, limit: z.number().int().min(1).max(20).optional() }),
      run: ({ limit, ...r }) => eras(db, { range: checkRange(r), limit: limit ?? 8 }),
    }),
    tool({
      name: "tag_trends",
      description: "Genre or mood shares over time from LLM-generated song tags. Check coverage: untagged plays are left out.",
      schema: z.strictObject({ tag: z.enum(["genres", "moods"]), ...range, period }),
      run: ({ tag, period: p, ...r }) => {
        const fn = tag === "genres" ? genreSeries : moodSeries;
        const s = fn(db, { range: checkRange(r), period: p ?? "month" });
        const top = new Set(s.totals.slice(0, 8).map((t) => t.value));
        return { ...s, totals: s.totals.slice(0, 15), series: s.series.filter((x) => top.has(x.value)) };
      },
    }),
    tool({
      name: "energy_by_hour",
      description: "Average tagged energy and valence (1-5) of listens per local hour.",
      schema: z.strictObject(range),
      run: (input) => energyByHour(db, { range: checkRange(input) }),
    }),
    tool({
      name: "trips",
      description: "Listening while abroad: runs of plays from countries other than home, with top songs.",
      schema: z.strictObject(range),
      run: (input) => trips(db, { range: checkRange(input), homeCountry, minPlays: 5, topTracks: 5 }),
    }),
  ];
}
