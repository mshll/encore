import { count } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { ownedPlaylists, savedTracks } from "../../db/schema";
import { libraryCursor } from "../../jobs/definitions";
import { entryEvidence, groupEntries, libraryAnalysis, loadLibrary, plainReason, PLAY_CLASSES, songGroup } from "../../library/analysis";
import type { Env } from "../context";
import { parse } from "../errors";

const groupQuery = z
  .object({
    kind: z.enum(["songs", "duplicates", "unsaved"]).default("songs"),
    where: z.string().min(1).max(64).optional(),
    classes: z
      .string()
      .transform((v) => v.split(",").filter(Boolean))
      .pipe(z.array(z.enum(PLAY_CLASSES)).min(1))
      .optional(),
    artist: z.string().min(1).max(200).optional(),
    savedMonth: z.string().optional(),
  })
  .transform((q) => (q.kind === "unsaved" ? { kind: q.kind } : q.kind === "duplicates" ? { kind: q.kind, where: q.where } : q));

export const libraryRoutes = new Hono<Env>()
  .get("/analysis", (c) => {
    const { db, settings, now } = c.var.deps;
    const cursor = libraryCursor(db);
    return c.json({
      library: {
        savedTracks: db.select({ n: count() }).from(savedTracks).get()!.n,
        playlists: db.select({ n: count() }).from(ownedPlaylists).get()!.n,
        syncing: cursor.phase !== "idle",
        lastSyncAt: cursor.phase === "idle" && cursor.completedAt ? new Date(cursor.completedAt).toISOString() : null,
      },
      ...libraryAnalysis(loadLibrary(db, now(), settings.get())),
    });
  })
  .get("/songs", (c) => {
    const { db, settings, now } = c.var.deps;
    const query = c.req.query();
    const group = parse(songGroup, parse(groupQuery, query));
    const { limit, offset } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }), query);
    const snapshot = loadLibrary(db, now(), settings.get());
    const entries = groupEntries(snapshot, group);
    return c.json({
      group,
      total: entries.length,
      limit,
      offset,
      items: entries.slice(offset, offset + limit).map((e) => ({
        uri: e.uri,
        where: e.where,
        positions: e.positions,
        reason: plainReason(snapshot, e),
        ...entryEvidence(e),
      })),
    });
  });
