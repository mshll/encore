import { Hono } from "hono";
import { z } from "zod";
import type { Context } from "hono";
import { count, eq } from "drizzle-orm";
import { libraryPlans, ownedPlaylists, savedTracks, STANDING_CADENCES } from "../../db/schema";
import { libraryCursor } from "../../jobs/definitions";
import { entryEvidence, groupEntries, libraryAnalysis, loadLibrary, plainReason, PLAY_CLASSES, songGroup } from "../../library/analysis";
import { BatchBusyError, BatchNotFoundError, getBatch, listBatches, startApply, startUndo, type Started } from "../../library/apply";
import { dismissPlan, getPlan, ITEM_STATUSES, listPlans, PlanNotFoundError, PlanSelectionError, planFromGroup, restorePlan, updateItems } from "../../library/plans";
import { ensureRulePlans } from "../../library/rules";
import { continuePlanConversation, planConversation, startPlanConversation } from "../../library/planner";
import { createStanding, deleteStanding, listStanding, StandingNotFoundError, updateStanding } from "../../library/standing";
import { respond, toApiError } from "../assistant";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";

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

const id = z.coerce.number().int().positive();
const selection = z.union([z.array(z.number().int().positive()).min(1).max(5000), z.literal("all")]);

function planError(error: unknown): never {
  if (error instanceof PlanNotFoundError || error instanceof BatchNotFoundError) throw new ApiError(404, "not_found", "Not found");
  if (error instanceof PlanSelectionError) throw new ApiError(400, "invalid_selection", error.message, error.ids.length ? { ids: error.ids } : undefined);
  if (error instanceof BatchBusyError) throw new ApiError(409, "batch_running", error.message);
  if (error instanceof StandingNotFoundError) throw new ApiError(404, "not_found", "Not found");
  throw toApiError(error);
}

function guarded<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    planError(error);
  }
}

/** Apply and undo answer at once with the batch; the Spotify writes go on after the response, whether or not anyone is listening. */
function background(c: Context<Env>, start: () => Started) {
  const { db, spotifyAuth, spotify } = c.var.deps;
  if (!spotifyAuth.status().connected) throw new ApiError(409, "spotify_not_connected", "Connect Spotify first");
  const gate = spotify.gate();
  if (gate) throw new ApiError(503, "spotify_paused", "Spotify calls are paused", { reason: gate.reason, until: new Date(gate.blockedUntil).toISOString() });
  const { batchId, finished } = guarded(start);
  finished.catch((error: unknown) => console.error(`[library] batch ${batchId}: ${error instanceof Error ? error.message : String(error)}`));
  return c.json({ batch: getBatch(db, batchId) }, 202);
}

export const planRoutes = new Hono<Env>()
  .get("/", (c) => {
    const { db, now } = c.var.deps;
    ensureRulePlans(db, now());
    return c.json(listPlans(db));
  })
  .post("/", async (c) => {
    const { group } = parse(z.strictObject({ group: songGroup }), await jsonBody(c));
    const { db, settings, now } = c.var.deps;
    const planId = guarded(() => planFromGroup(db, loadLibrary(db, now(), settings.get()), group, now()));
    return c.json({ id: planId }, 201);
  })
  .get("/:id", (c) => {
    const q = parse(z.object({ status: z.enum(ITEM_STATUSES).default("open"), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) }), c.req.query());
    return c.json(guarded(() => getPlan(c.var.deps.db, parse(id, c.req.param("id")), q)));
  })
  .patch("/:id/items", async (c) => {
    const body = parse(z.strictObject({ ids: selection, included: z.boolean().optional(), action: z.enum(["archive", "remove"]).optional() }).refine((b) => b.included !== undefined || b.action, "Change included or action"), await jsonBody(c));
    const { db, now } = c.var.deps;
    return c.json(guarded(() => updateItems(db, parse(id, c.req.param("id")), body, now())));
  })
  .post("/:id/dismiss", async (c) => {
    const { ids } = parse(z.strictObject({ ids: selection.default("all") }), await jsonBody(c));
    const { db, now } = c.var.deps;
    return c.json(guarded(() => dismissPlan(db, parse(id, c.req.param("id")), ids, now())));
  })
  .post("/:id/restore", async (c) => {
    const { ids } = parse(z.strictObject({ ids: selection.default("all") }), await jsonBody(c));
    const { db, now } = c.var.deps;
    return c.json(guarded(() => restorePlan(db, parse(id, c.req.param("id")), ids, now())));
  })
  .post("/:id/apply", (c) => {
    const { db, spotify, now } = c.var.deps;
    const planId = parse(id, c.req.param("id"));
    return background(c, () => startApply({ db, spotify, now }, planId));
  });

const message = z.string().trim().min(1).max(2000);

export const conversationRoutes = new Hono<Env>()
  .post("/", async (c) => {
    const body = parse(z.strictObject({ message, threadId: z.number().int().positive().optional() }), await jsonBody(c));
    return respond(c, (ctx, onEvent) => (body.threadId ? continuePlanConversation(ctx, body.threadId, body.message, onEvent) : startPlanConversation(ctx, body.message, onEvent)));
  })
  .get("/:id", (c) => {
    const { db } = c.var.deps;
    const threadId = parse(id, c.req.param("id"));
    const turns = planConversation(db, threadId);
    if (turns.length === 0) throw new ApiError(404, "not_found", "Not found");
    const plan = db.select({ id: libraryPlans.id }).from(libraryPlans).where(eq(libraryPlans.threadId, threadId)).get();
    return c.json({ threadId, planId: plan?.id ?? null, turns });
  });

const standingBody = z.strictObject({ instruction: z.string().trim().min(1).max(1000), cadence: z.enum(STANDING_CADENCES), enabled: z.boolean().optional() });

export const standingRoutes = new Hono<Env>()
  .get("/", (c) => c.json({ items: listStanding(c.var.deps.db, c.var.deps.now()) }))
  .post("/", async (c) => {
    const body = parse(standingBody, await jsonBody(c));
    return c.json(createStanding(c.var.deps.db, body, c.var.deps.now()), 201);
  })
  .patch("/:id", async (c) => {
    const body = parse(standingBody.partial(), await jsonBody(c));
    const { db, now } = c.var.deps;
    return c.json(guarded(() => updateStanding(db, parse(id, c.req.param("id")), body, now())));
  })
  .delete("/:id", (c) => {
    guarded(() => deleteStanding(c.var.deps.db, parse(id, c.req.param("id"))));
    return c.json({ deleted: true });
  });

export const batchRoutes = new Hono<Env>()
  .get("/", (c) => c.json({ items: listBatches(c.var.deps.db, 50) }))
  .get("/:id", (c) => c.json({ batch: guarded(() => getBatch(c.var.deps.db, parse(id, c.req.param("id")))) }))
  .post("/:id/undo", (c) => {
    const { db, spotify, now } = c.var.deps;
    const batchId = parse(id, c.req.param("id"));
    return background(c, () => startUndo({ db, spotify, now }, batchId));
  });

export const libraryRoutes = new Hono<Env>()
  .route("/plans", planRoutes)
  .route("/batches", batchRoutes)
  .route("/conversations", conversationRoutes)
  .route("/standing", standingRoutes)
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
