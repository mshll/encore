import { Hono } from "hono";
import { z } from "zod";
import { artistPage, albumPage, trackPage } from "../../analytics/entities";
import { history } from "../../analytics/history";
import { clock, devices, overview, timeSeries } from "../../analytics/overview";
import { forgotten, onThisDay } from "../../analytics/recall";
import { momentSplit, skips } from "../../analytics/skips";
import { search } from "../../analytics/search";
import { energyByHour, genreSeries, moodSeries } from "../../analytics/tags";
import { eras, topAlbums, topArtists, topTracks } from "../../analytics/top";
import { trips } from "../../analytics/trips";
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
const period = z.enum(["day", "week", "month", "year"]).default("month");
const top = ranged({ limit: int(1, 200, 50), offset: int(0, 1_000_000, 0), sort: z.enum(["hours", "listens", "plays"]).default("hours") });
const topAt = top.extend({ weekday: z.coerce.number().int().min(1).max(7).optional(), hour: z.coerce.number().int().min(0).max(23).optional() });

function found<T>(value: T | null): T {
  if (value === null) throw new ApiError(404, "not_found", "No plays found");
  return value;
}

export const statsRoutes = new Hono<Env>()
  .get("/overview", (c) => c.json(overview(c.var.deps.db, { range: range(parse(ranged({}), c.req.query())) })))
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
    return c.json(skips(c.var.deps.db, { range: range(q), minPlays: q.minPlays, limit: q.limit }));
  })
  .get("/skips/split", (c) => {
    const q = parse(
      ranged({
        minPlays: int(2, 1000, 8),
        minContextPlays: int(1, 1000, 5),
        limit: int(1, 500, 100),
        class: z.enum(["keeper", "wrong_moment", "dislike", "mixed"]).optional(),
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
  skipped: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  source: z.enum(PLAY_SOURCES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: int(1, 500, 100),
  offset: int(0, 10_000_000, 0),
});

export const historyRoutes = new Hono<Env>().get("/", (c) => {
  const q = parse(historyQuery, c.req.query());
  return c.json(history(c.var.deps.db, { ...q, range: range(q) }));
});

export const searchRoutes = new Hono<Env>().get("/", (c) => {
  const q = parse(z.object({ q: z.string().trim().min(1).max(200), limit: int(1, 50, 8) }), c.req.query());
  return c.json(search(c.var.deps.db, q));
});
