import { Hono } from "hono";
import { z } from "zod";
import { attachConversation, deleteConversation, getConversation, listConversations, renameConversation, sendMessage } from "../../chat/service";
import { SUBJECT_KINDS } from "../../db/schema";
import { pageContextSchema } from "../../llm/pageContext";
import { mapped, respond } from "../assistant";
import type { Env } from "../context";
import { jsonBody, parse } from "../errors";

const id = z.object({ id: z.coerce.number().int().min(1) });
const message = z.object({ message: z.string().trim().min(1).max(2000), context: pageContextSchema.optional() });

export const chatRoutes = new Hono<Env>()
  .post("/", async (c) => {
    const body = parse(message, await jsonBody(c));
    return respond(c, (ctx, onEvent) => sendMessage(ctx, { conversationId: null, ...body }, onEvent), 201);
  })
  .get("/conversations", (c) => {
    const q = parse(z.object({ q: z.string().trim().max(200).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), c.req.query());
    return c.json(listConversations(c.var.deps.db, { q: q.q || undefined, limit: q.limit }));
  })
  .post("/attach", async (c) => {
    const body = parse(z.strictObject({ kind: z.enum(SUBJECT_KINDS), id: z.number().int().min(1) }), await jsonBody(c));
    const { db, now } = c.var.deps;
    return c.json({ conversationId: await mapped(() => attachConversation(db, body.kind, body.id, now())) });
  })
  .get("/:id", async (c) => c.json(await mapped(() => getConversation(c.var.deps.db, parse(id, c.req.param()).id))))
  .post("/:id/messages", async (c) => {
    const conversationId = parse(id, c.req.param()).id;
    const body = parse(message, await jsonBody(c));
    await mapped(() => getConversation(c.var.deps.db, conversationId));
    return respond(c, (ctx, onEvent) => sendMessage(ctx, { conversationId, ...body }, onEvent));
  })
  .patch("/:id", async (c) => {
    const conversationId = parse(id, c.req.param()).id;
    const body = parse(z.strictObject({ title: z.string().trim().min(1).max(120) }), await jsonBody(c));
    const { db, now } = c.var.deps;
    return c.json(await mapped(() => renameConversation(db, conversationId, body.title, now())));
  })
  .delete("/:id", async (c) => {
    await mapped(() => deleteConversation(c.var.deps.db, parse(id, c.req.param()).id));
    return c.json({ deleted: true });
  });
