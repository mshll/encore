import { Hono } from "hono";
import { z } from "zod";
import { AliasError, addAlias, listAliases, removeAlias } from "../../artists/aliases";
import { emptyTrash, restorePlays, songPlayIds, trashCount, trashPlays } from "../../plays/trash";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const ids = z.object({ ids: z.array(z.number().int().positive()).min(1).max(5000) }).strict();

export const playRoutes = new Hono<Env>()
  .get("/trash", (c) => c.json({ plays: trashCount(c.var.deps.db) }))
  .post("/trash", async (c) => {
    const body = parse(ids, await jsonBody(c));
    return c.json({ trashed: trashPlays(c.var.deps.db, body.ids, c.var.deps.now()) });
  })
  .post("/trash/song", async (c) => {
    const body = parse(z.object({ songKey: z.string().min(1), from: day.optional(), to: day.optional() }).strict(), await jsonBody(c));
    if (body.from && body.to && body.from > body.to) throw new ApiError(400, "invalid_request", "from must be on or before to");
    const { db, now } = c.var.deps;
    const found = songPlayIds(db, body.songKey, { from: body.from, to: body.to });
    return c.json({ trashed: trashPlays(db, found, now()), ids: found });
  })
  .post("/restore", async (c) => {
    const body = parse(ids, await jsonBody(c));
    return c.json({ restored: restorePlays(c.var.deps.db, body.ids) });
  })
  .delete("/trash", (c) => c.json({ deleted: emptyTrash(c.var.deps.db) }));

const ALIAS_STATUS = { same_artist: 400, unknown_artist: 404, already_alias: 409, alias_chain: 409, not_alias: 404 } as const;

function aliasError(error: unknown): never {
  if (error instanceof AliasError) throw new ApiError(ALIAS_STATUS[error.code], error.code, error.message);
  throw error;
}

const name = z.string().trim().min(1).max(300);

export const artistRoutes = new Hono<Env>()
  .get("/aliases", (c) => c.json({ items: listAliases(c.var.deps.db) }))
  .post("/aliases", async (c) => {
    const body = parse(z.object({ alias: name, canonical: name }).strict(), await jsonBody(c));
    try {
      return c.json(addAlias(c.var.deps.db, body.alias, body.canonical, c.var.deps.now()), 201);
    } catch (error) {
      return aliasError(error);
    }
  })
  .delete("/aliases", (c) => {
    const q = parse(z.object({ alias: name }), c.req.query());
    try {
      removeAlias(c.var.deps.db, q.alias);
    } catch (error) {
      return aliasError(error);
    }
    return c.json({ removed: q.alias });
  });
