import { Hono } from "hono";
import { z } from "zod";
import { tagBulkSchema } from "../../tags/schema";
import { pendingTracks, UnknownTracksError, upsertTags } from "../../tags/service";
import { CONFIDENCE, GENRES, MOODS } from "../../tags/vocabulary";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";

const pendingQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const tagRoutes = new Hono<Env>()
  .get("/vocabulary", (c) =>
    c.json({ genres: GENRES, moods: MOODS, confidence: CONFIDENCE, energy: { min: 1, max: 5 }, valence: { min: 1, max: 5 }, language: "ISO 639-1 code or 'instrumental'" }),
  )
  .get("/pending", (c) => {
    const q = parse(pendingQuery, c.req.query());
    return c.json({ ...pendingTracks(c.var.deps.db, q.limit, q.offset), limit: q.limit, offset: q.offset });
  })
  .post("/", async (c) => {
    const body = parse(tagBulkSchema, await jsonBody(c));
    try {
      return c.json({ upserted: upsertTags(c.var.deps.db, body.tags, c.var.deps.now()) });
    } catch (error) {
      if (error instanceof UnknownTracksError) throw new ApiError(400, "unknown_tracks", error.message, { uris: error.uris });
      throw error;
    }
  });
