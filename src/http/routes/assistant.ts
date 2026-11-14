import { Hono } from "hono";
import { z } from "zod";
import { ask, deleteAskThread, getAskThread, listAskThreads } from "../../ask/service";
import { PICK_STATES } from "../../db/schema";
import { generateDigest, listDigests, renderDigest } from "../../digest/service";
import { budgetStatus, spendDetail } from "../../llm/ledger";
import { listBlocks, removeBlock } from "../../library/blocks";
import { cachedNote, trackNote } from "../../notes/service";
import { generatePicks, pickWeeks, picksPlaylist, syncPicksPlaylist, weekOf, weekPicks } from "../../picks/service";
import { playSet } from "../../sets/play";
import { savePick, updatePickState } from "../../assistant/api";
import { saveSetPlaylist } from "../../sets/playlist";
import { djSessionView } from "./dj";
import { createSet, deleteSet, getSet, listSets, pinSetItem, refineSet, removeSetItem } from "../../sets/service";
import { featureContext, mapped, respond } from "../assistant";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";

const id = z.object({ id: z.coerce.number().int().min(1) });
const item = id.extend({ position: z.coerce.number().int().min(1) });
const paging = (max: number, fallback: number) => z.object({ limit: z.coerce.number().int().min(1).max(max).default(fallback), offset: z.coerce.number().int().min(0).default(0) });
const text = (max: number) => z.string().trim().min(1).max(max);

export const setRoutes = new Hono<Env>()
  .post("/", async (c) => {
    const body = parse(z.object({ request: text(2000) }), await jsonBody(c));
    return respond(c, (ctx, onEvent) => createSet(ctx, body.request, onEvent), 201);
  })
  .get("/", (c) => {
    const q = parse(paging(100, 20), c.req.query());
    return c.json(listSets(c.var.deps.db, q.limit, q.offset));
  })
  .get("/:id", (c) => {
    const set = getSet(c.var.deps.db, parse(id, c.req.param()).id);
    if (!set) throw new ApiError(404, "not_found", "Not found");
    return c.json(set);
  })
  .post("/:id/messages", async (c) => {
    const setId = parse(id, c.req.param()).id;
    const body = parse(z.object({ message: text(2000) }), await jsonBody(c));
    if (!getSet(c.var.deps.db, setId)) throw new ApiError(404, "not_found", "Not found");
    return respond(c, (ctx, onEvent) => refineSet(ctx, setId, body.message, onEvent));
  })
  .post("/:id/playlist", async (c) => {
    const { db, spotify, now } = c.var.deps;
    const setId = parse(id, c.req.param()).id;
    return c.json(await mapped(() => saveSetPlaylist(db, spotify, setId, now())));
  })
  .post("/:id/play", async (c) => {
    const { db, services } = c.var.deps;
    const setId = parse(id, c.req.param()).id;
    const body = parse(z.object({ deviceId: z.string().min(1).max(100).optional() }).strict(), await jsonBody(c).catch(() => ({})));
    return c.json({ session: djSessionView(db, await mapped(() => playSet(db, services.dj, setId, body.deviceId))) });
  })
  .patch("/:id/items/:position", async (c) => {
    const p = parse(item, c.req.param());
    const body = parse(z.object({ pinned: z.boolean() }).strict(), await jsonBody(c));
    return c.json(await mapped(() => pinSetItem(c.var.deps.db, p.id, p.position, body.pinned)));
  })
  .delete("/:id/items/:position", async (c) => {
    const p = parse(item, c.req.param());
    return c.json(await mapped(() => removeSetItem(c.var.deps.db, p.id, p.position, c.var.deps.now())));
  })
  .delete("/:id", async (c) => {
    await mapped(() => deleteSet(c.var.deps.db, parse(id, c.req.param()).id));
    return c.json({ deleted: true });
  });

const week = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const pickRoutes = new Hono<Env>()
  .get("/", (c) => {
    const { db, config, now } = c.var.deps;
    const q = parse(z.object({ week: week.optional() }), c.req.query());
    return c.json({ ...weekPicks(db, q.week ?? weekOf(now(), config.timezone), now()), playlist: picksPlaylist(db) });
  })
  .get("/weeks", (c) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(104).default(12) }), c.req.query());
    return c.json({ items: pickWeeks(c.var.deps.db, q.limit) });
  })
  .post("/generate", (c) => respond(c, (ctx, onEvent) => generatePicks(ctx, onEvent), 201))
  .patch("/:id", async (c) => {
    const { db, config, spotify, services, now } = c.var.deps;
    const pickId = parse(id, c.req.param()).id;
    const body = parse(z.object({ state: z.enum(PICK_STATES) }), await jsonBody(c));
    const pick = await mapped(async () => (body.state === "saved" ? savePick(services.assistant, pickId) : updatePickState(services.assistant, pickId, body.state)));
    if (config.llm.picksPlaylist && picksPlaylist(db) && pick.week === weekOf(now(), config.timezone)) await mapped(() => syncPicksPlaylist(db, spotify, config.timezone, now()));
    return c.json(pick);
  });

export const blockRoutes = new Hono<Env>()
  .get("/", (c) => c.json({ items: listBlocks(c.var.deps.db).map((b) => ({ ...b, createdAt: new Date(b.createdAt).toISOString() })) }))
  .delete("/:id", (c) => {
    const blockId = parse(id, c.req.param()).id;
    const block = listBlocks(c.var.deps.db).find((b) => b.id === blockId);
    if (!block) throw new ApiError(404, "not_found", "Not found");
    removeBlock(c.var.deps.db, block.kind, block.key);
    return c.json({ deleted: true });
  });

export const askRoutes = new Hono<Env>()
  .post("/", async (c) => {
    const body = parse(z.object({ question: text(1000), threadId: z.number().int().min(1).optional() }), await jsonBody(c));
    return respond(c, (ctx, onEvent) => ask(ctx, body.question, body.threadId ?? null, onEvent));
  })
  .get("/threads", (c) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }), c.req.query());
    return c.json({ items: listAskThreads(c.var.deps.db, q.limit) });
  })
  .get("/threads/:id", async (c) => c.json(await mapped(() => getAskThread(c.var.deps.db, parse(id, c.req.param()).id))))
  .delete("/threads/:id", async (c) => {
    await mapped(() => deleteAskThread(c.var.deps.db, parse(id, c.req.param()).id));
    return c.json({ deleted: true });
  });

const noteSubject = z
  .object({ songKey: z.string().min(1).optional(), uri: z.string().regex(/^spotify:track:[A-Za-z0-9]{22}$/).optional() })
  .refine((v) => v.songKey || v.uri, { message: "songKey or uri is required", path: ["songKey"] });

export const noteRoutes = new Hono<Env>()
  .get("/", (c) => {
    const q = parse(z.object({ songKey: z.string().min(1) }), c.req.query());
    const note = cachedNote(c.var.deps.db, q.songKey);
    if (!note) throw new ApiError(404, "not_found", "No note for this song yet");
    return c.json(note);
  })
  .post("/", async (c) => {
    const body = parse(noteSubject, await jsonBody(c));
    return c.json(await mapped(() => trackNote(featureContext(c), body)));
  });

const kind = z.enum(["weekly", "monthly"]);

export const digestRoutes = new Hono<Env>()
  .get("/", (c) => {
    const q = parse(z.object({ kind: kind.optional(), limit: z.coerce.number().int().min(1).max(100).default(20) }), c.req.query());
    return c.json({ items: listDigests(c.var.deps.db, q.kind, q.limit) });
  })
  .get("/:id", async (c) => c.json(await mapped(() => renderDigest(c.var.deps.db, parse(id, c.req.param()).id))))
  .post("/generate", async (c) => {
    const body = parse(z.object({ kind }), await jsonBody(c));
    return c.json(await mapped(() => generateDigest(featureContext(c), body.kind)));
  });

export const llmRoutes = new Hono<Env>().get("/spend", (c) => {
  const { db, config, now } = c.var.deps;
  const q = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), limit: z.coerce.number().int().min(1).max(500).default(50) }), c.req.query());
  const budget = budgetStatus(db, config.timezone, config.llm.monthlyBudgetUsd, now());
  const detail = spendDetail(db, q.month ?? budget.month, q.limit);
  const perMTok = Object.fromEntries(
    Object.entries(config.llm.prices).map(([model, p]) => [model, Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.round(v * 1e6 * 1000) / 1000]))]),
  );
  return c.json({ ...detail, budget, model: config.llm.model, pricesPerMTok: perMTok, webSearchPerRequest: config.llm.webSearchPerRequest });
});
