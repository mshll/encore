import { inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { tracks } from "../../db/schema";
import type { Env } from "../context";
import { parse } from "../errors";

const trackUri = z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/);

export const trackRoutes = new Hono<Env>().get("/", (c) => {
  const { uri } = parse(z.object({ uri: z.array(trackUri).min(1).max(500) }), { uri: c.req.queries("uri") ?? [] });
  const rows = c.var.deps.db
    .select({ uri: tracks.uri, songKey: tracks.songKey, name: tracks.name, artist: tracks.artist, album: tracks.album, albumArtUrl: tracks.albumArtUrl })
    .from(tracks)
    .where(inArray(tracks.uri, uri))
    .all();
  return c.json({ items: rows });
});
