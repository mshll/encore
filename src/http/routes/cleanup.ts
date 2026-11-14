import { count } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { applyCleanup, CleanupPartialError, CleanupSelectionError, listBatches, undoCleanup } from "../../cleanup/apply";
import { dismissProposals, listProposals, proposalCounts } from "../../cleanup/proposals";
import { CLEANUP_KINDS, CLEANUP_STATUSES, ownedPlaylists, savedTracks } from "../../db/schema";
import { libraryCursor } from "../../jobs/definitions";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";

const ids = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }).strict();

function selectionError(error: unknown): never {
  if (error instanceof CleanupSelectionError) throw new ApiError(400, "invalid_selection", error.message, error.ids.length ? { ids: error.ids } : undefined);
  if (error instanceof CleanupPartialError) throw new ApiError(502, "cleanup_partial", error.message, { batchId: error.batchId });
  throw error;
}

export const cleanupRoutes = new Hono<Env>()
  .get("/", (c) => {
    const { db } = c.var.deps;
    const q = parse(
      z.object({
        kind: z.enum(CLEANUP_KINDS).optional(),
        status: z.enum(CLEANUP_STATUSES).default("open"),
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      }),
      c.req.query(),
    );
    const cursor = libraryCursor(db);
    return c.json({
      counts: proposalCounts(db),
      library: {
        savedTracks: db.select({ n: count() }).from(savedTracks).get()!.n,
        playlists: db.select({ n: count() }).from(ownedPlaylists).get()!.n,
        syncing: cursor.phase !== "idle",
        lastSyncAt: cursor.phase === "idle" && cursor.completedAt ? new Date(cursor.completedAt).toISOString() : null,
      },
      ...listProposals(db, q),
      limit: q.limit,
      offset: q.offset,
    });
  })
  .post("/dismiss", async (c) => {
    const body = parse(ids, await jsonBody(c));
    return c.json({ dismissed: dismissProposals(c.var.deps.db, body.ids, c.var.deps.now()) });
  })
  .post("/apply", async (c) => {
    const body = parse(ids, await jsonBody(c));
    const { db, spotify, now } = c.var.deps;
    try {
      return c.json(await applyCleanup(db, spotify, body.ids, now()));
    } catch (error) {
      selectionError(error);
    }
  })
  .get("/batches", (c) => c.json({ items: listBatches(c.var.deps.db, 50) }))
  .post("/batches/:id/undo", async (c) => {
    const id = parse(z.coerce.number().int().positive(), c.req.param("id"));
    const { db, spotify, now } = c.var.deps;
    try {
      return c.json(await undoCleanup(db, spotify, id, now()));
    } catch (error) {
      selectionError(error);
    }
  });
