import { Hono } from "hono";
import { z } from "zod";
import { PLAY_OUTCOMES } from "../../analytics/common";
import { decades } from "../../analytics/decades";
import { comebacks, discovery, loyalty, monthDiscoveries } from "../../analytics/discovery";
import { artistPage, albumPage, trackPage } from "../../analytics/entities";
import { canonicalOf } from "../../artists/aliases";
import { history } from "../../analytics/history";
import { clock, devices, overview, timeSeries } from "../../analytics/overview";
import { forgotten, onThisDay } from "../../analytics/recall";
import { MOMENT_CLASSES, momentSplit, skipContext, skips } from "../../analytics/skips";
import { search } from "../../analytics/search";
import { podcasts } from "../../analytics/podcasts";
import { weekMoments } from "../../analytics/moments";
import { milestones, records, streaks } from "../../analytics/records";
import { onRepeat } from "../../analytics/repeat";
import { energyByHour, genreSeries, moodSeries } from "../../analytics/tags";
import { eras, topAlbums, topArtists, topTracks } from "../../analytics/top";
import { trips } from "../../analytics/trips";
import { currentWeek, weekSoFar } from "../../analytics/week";
import { listeningYears, yearCompare } from "../../analytics/years";
import { DEVICES, PLAY_KINDS, PLAY_SOURCES } from "../../db/schema";
import { localTime } from "../../plays/localTime";
import type { Env } from "../context";
import { ApiError, parse } from "../errors";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const int = (min: number, max: number, fallback: number) => z.coerce.number().int().min(min).max(max).default(fallback);

const ranged = <T extends z.ZodRawShape>(shape: T) => z.object({ from: day.optional(), to: day.optional(), ...shape });

function range(q: { from?: string; to?: string }) {
  if (q.from && q.to && q.from > q.to) throw new ApiError(400, "invalid_request", "from must be on or before to");
  return { from: q.from, to: q.to };
}
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "expected YYYY-MM");
const year = z.coerce.number().int().min(1900).max(2999);
const period = z.enum(["day", "week", "month", "year"]).default("month");
const top = ranged({ limit: int(1, 200, 50), offset: int(0, 1_000_000, 0), sort: z.enum(["hours", "listens", "plays"]).default("hours"), q: z.string().trim().min(1).max(200).optional() });
const topAt = top.extend({ weekday: z.coerce.number().int().min(1).max(7).optional(), hour: z.coerce.number().int().min(0).max(23).optional() });

function found<T>(value: T | null): T {
  if (value === null) throw new ApiError(404, "not_found", "No plays found");
  return value;
}

export const statsRoutes = new Hono<Env>()
  .get("/overview", (c) => c.json(overview(c.var.deps.db, { range: range(parse(ranged({}), c.req.query())) })))
  .get("/week", (c) => {
    const { db, settings, now } = c.var.deps;
    const { timezone, llm } = settings.get();
    return c.json(weekSoFar(db, { now: localTime(now(), timezone), recapWeekday: llm.digestSlot.weekday }));
  })
  .get("/moments", (c) => {
    const { db, settings, now } = c.var.deps;
    const { timezone, llm } = settings.get();
    const today = localTime(now(), timezone).day;
    const { from } = currentWeek(today, llm.digestSlot.weekday);
    return c.json({ items: weekMoments(db, { from, today }) });
  })
  .get("/on-repeat", (c) => {
    const { db, settings, now } = c.var.deps;
    const q = parse(z.object({ limit: int(1, 20, 5) }), c.req.query());
    return c.json(onRepeat(db, { today: localTime(now(), settings.get().timezone).day, limit: q.limit }));
  })
  .get("/discovery", (c) => c.json(discovery(c.var.deps.db, { range: range(parse(ranged({}), c.req.query())) })))
  .get("/discovery/month", (c) => {
    const q = parse(z.object({ month, limit: int(1, 100, 20) }), c.req.query());
    return c.json(monthDiscoveries(c.var.deps.db, q));
  })
  .get("/comebacks", (c) => {
    const q = parse(ranged({ limit: int(1, 100, 20) }), c.req.query());
    return c.json(comebacks(c.var.deps.db, { range: range(q), limit: q.limit }));
  })
  .get("/loyalty", (c) => {
    const q = parse(ranged({ limit: int(1, 100, 20) }), c.req.query());
    return c.json(loyalty(c.var.deps.db, { range: range(q), limit: q.limit }));
  })
  .get("/streaks", (c) => {
    const { db, settings, now } = c.var.deps;
    const q = parse(ranged({ limit: int(1, 50, 5) }), c.req.query());
    return c.json(streaks(db, { range: range(q), today: localTime(now(), settings.get().timezone).day, limit: q.limit }));
  })
  .get("/records", (c) => c.json(records(c.var.deps.db, { range: range(parse(ranged({}), c.req.query())) })))
  .get("/milestones", (c) => {
    const q = parse(ranged({ limit: int(1, 200, 20) }), c.req.query());
    return c.json(milestones(c.var.deps.db, { range: range(q), limit: q.limit }));
  })
  .get("/decades", (c) => c.json(decades(c.var.deps.db, { range: range(parse(ranged({}), c.req.query())) })))
  .get("/years", (c) => {
    const { db, settings, now } = c.var.deps;
    const thisYear = Number(localTime(now(), settings.get().timezone).day.slice(0, 4));
    const q = parse(z.object({ a: year.optional(), b: year.optional() }), c.req.query());
    const b = q.b ?? listeningYears(db).at(-1) ?? thisYear;
    return c.json(yearCompare(db, { a: q.a ?? b - 1, b }));
  })
  .get("/podcasts", (c) => {
    const q = parse(ranged({ limit: int(1, 100, 20) }), c.req.query());
    return c.json(podcasts(c.var.deps.db, { range: range(q), limit: q.limit }));
  })
  .get("/timeseries", (c) => {
    const q = parse(ranged({ period }), c.req.query());
    return c.json(timeSeries(c.var.deps.db, { range: range(q), period: q.period }));
  })
  .get("/top/artists", (c) => {
    const q = parse(topAt, c.req.query());
    return c.json({ items: topArtists(c.var.deps.db, { ...q, range: range(q) }) });
  })
  .get("/top/tracks", (c) => {
    const q = parse(topAt, c.req.query());
    return c.json({ items: topTracks(c.var.deps.db, { ...q, range: range(q) }) });
  })
  .get("/top/albums", (c) => {
    const q = parse(top, c.req.query());
    return c.json({ items: topAlbums(c.var.deps.db, { ...q, range: range(q) }) });
  })
  .get("/eras", (c) => {
    const q = parse(ranged({ limit: int(1, 30, 10) }), c.req.query());
    return c.json(eras(c.var.deps.db, { range: range(q), limit: q.limit }));
  })
  .get("/clock", (c) => c.json(clock(c.var.deps.db, { range: range(parse(ranged({}), c.req.query())) })))
  .get("/devices", (c) => {
    const q = parse(ranged({ period }), c.req.query());
    return c.json(devices(c.var.deps.db, { range: range(q), period: q.period }));
  })
  .get("/skips", (c) => {
    const q = parse(ranged({ minPlays: int(1, 1000, 10), limit: int(1, 200, 50) }), c.req.query());
    const db = c.var.deps.db;
    return c.json({ ...skips(db, { range: range(q), minPlays: q.minPlays, limit: q.limit }), ...skipContext(db, { range: range(q), weekendDays: c.var.deps.settings.get().weekendDays }) });
  })
  .get("/skips/split", (c) => {
    const q = parse(
      ranged({
        minPlays: int(2, 1000, 8),
        minContextPlays: int(1, 1000, 5),
        limit: int(1, 500, 100),
        class: z.enum(MOMENT_CLASSES).optional(),
      }),
      c.req.query(),
    );
    return c.json(momentSplit(c.var.deps.db, { range: range(q), minPlays: q.minPlays, minContextPlays: q.minContextPlays, limit: q.limit, only: q.class, weekendDays: c.var.deps.settings.get().weekendDays }));
  })
  .get("/forgotten", (c) => {
    const q = parse(z.object({ days: int(1, 3650, 90), minListens: int(1, 10_000, 10), limit: int(1, 200, 50) }), c.req.query());
    return c.json(forgotten(c.var.deps.db, { ...q, asOf: c.var.deps.now() }));
  })
  .get("/on-this-day", (c) => {
    const { settings, now, db } = c.var.deps;
    const q = parse(z.object({ date: day.optional(), limit: int(1, 50, 5) }), c.req.query());
    return c.json(onThisDay(db, { date: q.date ?? localTime(now(), settings.get().timezone).day, limit: q.limit }));
  })
  .get("/trips", (c) => {
    const q = parse(ranged({ minPlays: int(1, 10_000, 5), topTracks: int(0, 50, 5) }), c.req.query());
    return c.json(trips(c.var.deps.db, { range: range(q), homeCountry: c.var.deps.settings.get().homeCountry, minPlays: q.minPlays, topTracks: q.topTracks }));
  })
  .get("/tags/genres", (c) => {
    const q = parse(ranged({ period }), c.req.query());
    return c.json(genreSeries(c.var.deps.db, { range: range(q), period: q.period }));
  })
  .get("/tags/moods", (c) => {
    const q = parse(ranged({ period }), c.req.query());
    return c.json(moodSeries(c.var.deps.db, { range: range(q), period: q.period }));
  })
  .get("/tags/energy", (c) => c.json(energyByHour(c.var.deps.db, { range: range(parse(ranged({}), c.req.query())) })));

export const entityRoutes = new Hono<Env>()
  .get("/artist", (c) => {
    const q = parse(ranged({ name: z.string().min(1), period }), c.req.query());
    const canonical = canonicalOf(c.var.deps.db, q.name);
    if (canonical !== null) throw new ApiError(404, "artist_alias", `${q.name} counts as ${canonical}`, { canonical });
    return c.json(found(artistPage(c.var.deps.db, { artist: q.name, range: range(q), period: q.period, weekendDays: c.var.deps.settings.get().weekendDays })));
  })
  .get("/album", (c) => {
    const q = parse(ranged({ artist: z.string().min(1), album: z.string().min(1), period }), c.req.query());
    return c.json(found(albumPage(c.var.deps.db, { artist: q.artist, album: q.album, range: range(q), period: q.period, weekendDays: c.var.deps.settings.get().weekendDays })));
  })
  .get("/track", (c) => {
    const q = parse(
      ranged({ songKey: z.string().min(1).optional(), uri: z.string().min(1).optional(), period }).refine((v) => v.songKey || v.uri, {
        message: "songKey or uri is required",
        path: ["songKey"],
      }),
      c.req.query(),
    );
    return c.json(found(trackPage(c.var.deps.db, { songKey: q.songKey, uri: q.uri, range: range(q), period: q.period, weekendDays: c.var.deps.settings.get().weekendDays })));
  });

const historyQuery = ranged({
  kind: z.enum(PLAY_KINDS).default("track"),
  artist: z.string().min(1).optional(),
  songKey: z.string().min(1).optional(),
  uri: z.string().min(1).optional(),
  device: z.enum(DEVICES).optional(),
  outcome: z.string().transform((v) => v.split(",")).pipe(z.array(z.enum(PLAY_OUTCOMES)).min(1)).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  source: z.enum(PLAY_SOURCES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  trash: z.stringbool().optional(),
  limit: int(1, 500, 100),
  offset: int(0, 10_000_000, 0),
});

export const historyRoutes = new Hono<Env>().get("/", (c) => {
  const { outcome, ...q } = parse(historyQuery, c.req.query());
  return c.json(history(c.var.deps.db, { ...q, outcomes: outcome, range: range(q) }));
});

export const searchRoutes = new Hono<Env>().get("/", (c) => {
  const q = parse(z.object({ q: z.string().trim().min(1).max(200), limit: int(1, 50, 8) }), c.req.query());
  return c.json(search(c.var.deps.db, q));
});
