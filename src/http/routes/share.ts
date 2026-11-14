import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { SHARE_KINDS } from "../../db/schema";
import { DigestNotFoundError } from "../../digest/service";
import { notFoundPage, sharePage } from "../../share/html";
import { countView, createShare, listShares, MAX_EXPIRY_DAYS, resolveShare, revokeShare, shareCard, ShareNotFoundError, shareUrl, shareView } from "../../share/service";
import type { RecapSnapshot } from "../../share/snapshot";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";
import { rateLimit } from "../rateLimit";

/** The owner's links: make one (the only time its URL is shown), list them, revoke one. Behind the session like the rest of /api. */
export const shareRoutes = new Hono<Env>()
  .get("/", (c) => {
    const q = parse(z.object({ kind: z.enum(SHARE_KINDS).optional(), ref: z.coerce.number().int().min(1).optional() }), c.req.query());
    const now = c.var.deps.now();
    return c.json({ items: listShares(c.var.deps.db, q).map((r) => shareView(r, now)) });
  })
  .post("/", async (c) => {
    const { db, now, config } = c.var.deps;
    const body = parse(z.object({ kind: z.enum(SHARE_KINDS), ref: z.number().int().min(1), expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS).nullable().optional() }).strict(), await jsonBody(c));
    try {
      const { token, row } = createShare(db, body, now());
      return c.json({ share: shareView(row, now()), url: shareUrl(config.publicBaseUrl, token) }, 201);
    } catch (error) {
      if (error instanceof DigestNotFoundError) throw new ApiError(404, "not_found", "Not found");
      throw error;
    }
  })
  .delete("/:id", (c) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().min(1) }), c.req.param());
    const now = c.var.deps.now();
    try {
      return c.json({ share: shareView(revokeShare(c.var.deps.db, id, now), now) });
    } catch (error) {
      if (error instanceof ShareNotFoundError) throw new ApiError(404, "not_found", "Not found");
      throw error;
    }
  });

/** A fixed budget across every client, so many addresses together cannot probe tokens or keep the server drawing cards. */
function globalLimit(limit: number, windowMs: number): MiddlewareHandler<Env> {
  let window = { startedAt: 0, count: 0 };
  return async (c, next) => {
    const now = c.var.deps.now();
    if (now - window.startedAt >= windowMs) window = { startedAt: now, count: 0 };
    if (++window.count > limit) return c.text("Too many requests", 429, { "retry-after": String(Math.ceil((window.startedAt + windowMs - now) / 1000)) });
    await next();
  };
}

/** Set on every /s response by the app, outside the default security headers so `no-referrer` wins over `same-origin`. */
export const PUBLIC_SHARE_HEADERS = { "x-robots-tag": "noindex, nofollow, noarchive", "referrer-policy": "no-referrer", "cache-control": "no-store" };

/**
 * The public side of a share: its page, its card and its snapshot, nothing else. Never reads the session cookie, so
 * the owner signed in sees exactly what a stranger sees. A token that is malformed, unknown, revoked or expired gets
 * one and the same 404, as does any other address under /s, so the app shell is never served there. Limits are per app,
 * made with the routes.
 */
export function publicShareRoutes(limits = { perClient: 60, everyone: 1200 }) {
  const perClient = rateLimit(limits.perClient, 60_000);
  const everyone = globalLimit(limits.everyone, 60_000);
  return new Hono<Env>()
    .use("*", async (c, next) => {
      try {
        await perClient(c, next);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 429) throw error;
        return c.text("Too many requests", 429, { "retry-after": "60" });
      }
    })
    .use("*", everyone)
    .get("/:token", (c) => {
      const { db, now, config } = c.var.deps;
      const token = c.req.param("token");
      const row = resolveShare(db, token, now());
      if (!row) return c.html(notFoundPage(), 404);
      if (c.req.method === "GET") countView(db, row.id, now());
      return c.html(sharePage(row.snapshot as RecapSnapshot, `${shareUrl(config.publicBaseUrl, token)}/card.png`));
    })
    .get("/:token/card.png", async (c) => {
      const { db, now } = c.var.deps;
      const row = resolveShare(db, c.req.param("token"), now());
      if (!row) return c.text("Not found", 404);
      return c.body(new Uint8Array(await shareCard(row)), 200, { "content-type": "image/png" });
    })
    .get("/:token/snapshot.json", (c) => {
      const { db, now } = c.var.deps;
      const row = resolveShare(db, c.req.param("token"), now());
      if (!row) return c.json({ error: { code: "not_found", message: "Not found" } }, 404);
      return c.json(row.snapshot);
    })
    .all("*", (c) => c.html(notFoundPage(), 404));
}
