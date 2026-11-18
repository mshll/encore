import { z } from "zod";
import { decades } from "../analytics/decades";
import { comebacks, discovery, loyalty, monthDiscoveries } from "../analytics/discovery";
import { artistPage, trackPage } from "../analytics/entities";
import { overview } from "../analytics/overview";
import { podcasts } from "../analytics/podcasts";
import { milestones, records, streaks } from "../analytics/records";
import { forgotten, onThisDay } from "../analytics/recall";
import { search } from "../analytics/search";
import { MOMENT_CLASSES, momentSplit } from "../analytics/skips";
import { energyByHour, genreSeries, moodSeries } from "../analytics/tags";
import { eras, topAlbums, topArtists, topTracks } from "../analytics/top";
import { trips } from "../analytics/trips";
import { obsessions } from "../analytics/obsessions";
import { encoreFinds, stayingPower } from "../analytics/rotation";
import { playStarts } from "../analytics/starts";
import { seasonal, variety } from "../analytics/variety";
import { listeningSessions } from "../analytics/when";
import { listeningYears, yearCompare } from "../analytics/years";
import type { Db } from "../db/client";
import { tool, ToolError, type AgentTool } from "../llm/agent";
import { localTime } from "../plays/localTime";
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
export function askTools(db: Db, { homeCountry, weekendDays, timezone }: { homeCountry?: string; weekendDays: readonly number[]; timezone: string }, now: number): AgentTool[] {
  const today = localTime(now, timezone).day;
  const noImage = <T extends { imageUrl: string | null }>({ imageUrl: _image, ...rest }: T) => rest;
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
      name: "discovery",
      description:
        "New artists and songs per month (first played that month, all time) and the share of each month's hours on songs first heard that month; the month the history starts in is left out. With month (YYYY-MM): that month's new artists and songs, with hours that month and since.",
      schema: z.strictObject({ ...range, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }),
      run: ({ month, ...r }) => {
        if (!month) return discovery(db, { range: checkRange(r) });
        const found = monthDiscoveries(db, { month, limit: 15 });
        return { ...found, artists: found.artists.map(noImage), songs: found.songs.map((s) => ({ ...songBrief(s), firstDay: s.firstDay, hoursSince: s.hoursSince })) };
      },
    }),
    tool({
      name: "comebacks",
      description:
        "Artists the owner played a lot (3+ hours), then barely (under 15 minutes a month) for 6+ months of other listening, then came back to (1+ hour since). The range filters by the day they came back. Distinct from forgotten, which lists songs not played lately.",
      schema: z.strictObject(range),
      run: (r) => {
        const found = comebacks(db, { range: checkRange(r), limit: 20 });
        return { ...found, items: found.items.map(noImage) };
      },
    }),
    tool({
      name: "loyalty",
      description: "Artists played 2+ hours in each of many calendar years, with the longest run of consecutive such years.",
      schema: z.strictObject(range),
      run: (r) => {
        const found = loyalty(db, { range: checkRange(r), limit: 20 });
        return { ...found, items: found.items.map(noImage) };
      },
    }),
    tool({
      name: "records",
      description:
        "Personal records in a period: most hours in a day, week and month, most listens of one song in a day, the longest session (plays less than 15 minutes apart), days in a row with a listen (current and longest), artists' longest daily runs, and milestones crossed (a song's 10th, 25th, 50th... listen; an artist's 10th, 50th, 100th... hour; total hours).",
      schema: z.strictObject(range),
      run: (r) => {
        const rg = checkRange(r);
        const s = streaks(db, { range: rg, today });
        return { ...records(db, { range: rg }), streaks: { ...s, artists: s.artists.map(noImage) }, milestones: milestones(db, { range: rg, limit: 20 }).items };
      },
    }),
    tool({
      name: "decades",
      description: "Hours by release decade of the songs played, and the listening age: the median release year weighted by hours. Songs without a release date are left out; check coverage.",
      schema: z.strictObject(range),
      run: (r) => decades(db, { range: checkRange(r) }),
    }),
    tool({
      name: "listening_sessions",
      description:
        "How the owner's listening falls into sittings in a period (a session ends after 15 minutes with nothing playing): the count, days with one, the mean per such day, the average length in minutes, how many start in each local hour (startHours[0] is midnight), the usual start hour, and the longest.",
      schema: z.strictObject(range),
      run: (r) => listeningSessions(db, { range: checkRange(r) }),
    }),
    tool({
      name: "play_starts",
      description:
        "How music plays began in a period, overall and by month, from the Spotify export's start reason: chosen (the owner clicked a row or pressed play), playedOn (the song before ended and this followed), nextBack (next or back pressed), other; shuffled is the share on shuffle. API and live plays are left out: check coverage. A play reached by next is not a judgement of the song before.",
      schema: z.strictObject(range),
      run: (r) => playStarts(db, { range: checkRange(r) }),
    }),
    tool({
      name: "variety",
      description:
        "How varied the owner's listening is, week by week (local weeks from Monday): distinct artists with a listen each week, and the share of the week's hours on its 10 most played artists (higher means more concentrated), with averages. Use it for questions about listening wider or narrower over time.",
      schema: z.strictObject(range),
      run: (r) => variety(db, { range: checkRange(r) }),
    }),
    tool({
      name: "seasonal",
      description:
        "Seasonal favourites: artists (hours) and songs (listens) that peak in the same calendar month (1-12) in at least 2 years: a month holding 1 h or 5 listens and 3 times the mean of that year's other months with music. Years with music in under 6 months are not judged, so a short history has none.",
      schema: z.strictObject(range),
      run: (r) => {
        const found = seasonal(db, { range: checkRange(r), limit: 15 });
        return { ...found, artists: found.artists.map(noImage), songs: found.songs.map(({ albumArtUrl: _art, ...s }) => s) };
      },
    }),
    tool({
      name: "staying_power",
      description:
        "How long songs first heard in a period stayed in rotation: a run starts on the first listen day and ends at the last listen day before a gap of more than 30 days. Songs listened to on 2+ days of their run entered rotation; median run in days, runs by length, and the longest runs (ongoing: still within 30 days of today).",
      schema: z.strictObject(range),
      run: (r) => {
        const found = stayingPower(db, { range: checkRange(r), today, limit: 15 });
        return { ...found, longest: found.longest.map(({ albumArtUrl: _art, ...s }) => s) };
      },
    }),
    tool({
      name: "encore_finds",
      description:
        "Songs encore itself suggested (weekly picks, new songs in sets, releases in New from your artists) that the owner had not listened to before, with listens since the first suggestion (only listens after it count). The range picks suggestions by day. Use it for how well encore's suggestions landed.",
      schema: z.strictObject(range),
      run: (r) => {
        const found = encoreFinds(db, { range: checkRange(r), timezone, limit: 20 });
        return { ...found, items: found.items.map(({ albumArtUrl: _art, ...s }) => s) };
      },
    }),
    tool({
      name: "obsessions",
      description:
        "Songs the owner was briefly obsessed with: a song's busiest 7 days in a row holding 8+ listens and 5 times its usual weekly listens, after which the next 28 days held at most a quarter as many. Biggest first, with dates, listens, usual listens a week and listens in the 28 days after. The range picks bursts by their first day.",
      schema: z.strictObject(range),
      run: (r) => {
        const found = obsessions(db, { range: checkRange(r), today, limit: 15 });
        return { ...found, items: found.items.map(({ albumArtUrl: _art, ...s }) => s) };
      },
    }),
    tool({
      name: "year_compare",
      description: "Two calendar years side by side: hours, plays, new artists and songs, the top artists with their rank in each year (change: positive rose), genre and mood shares. Default: the latest year against the one before.",
      schema: z.strictObject({ a: z.number().int().min(1900).max(2999).optional(), b: z.number().int().min(1900).max(2999).optional() }),
      run: ({ a, b }) => {
        const later = b ?? listeningYears(db).at(-1) ?? Number(today.slice(0, 4));
        const found = yearCompare(db, { a: a ?? later - 1, b: later });
        return { ...found, artists: found.artists.map(noImage) };
      },
    }),
    tool({
      name: "podcasts",
      description: "Podcast listening (episodes, not music): hours by show and the latest episodes.",
      schema: z.strictObject(range),
      run: (r) => podcasts(db, { range: checkRange(r), limit: 15 }),
    }),
    tool({
      name: "trips",
      description: "Listening while abroad: runs of plays from countries other than home, with top songs.",
      schema: z.strictObject(range),
      run: (input) => trips(db, { range: checkRange(input), homeCountry, minPlays: 5, topTracks: 5 }),
    }),
  ];
}
