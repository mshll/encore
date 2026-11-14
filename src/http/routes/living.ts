import { Hono } from "hono";
import { z } from "zod";
import { LIVING_KINDS } from "../../db/schema";
import { livingCover, livingCoverKey } from "../../living/cover";
import { refreshLiving, setLivingEnabled, type LivingDeps } from "../../living/refresh";
import { livingDetail, livingList, livingRefresh } from "../../living/view";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";

const kindParam = z.object({ kind: z.enum(LIVING_KINDS) });

const deps = (c: { var: Env["Variables"] }): LivingDeps => {
  const { db, spotify, settings, now } = c.var.deps;
  return { db, spotify, settings, now };
};

export const livingRoutes = new Hono<Env>()
  .get("/", (c) => c.json(livingList(deps(c))))
  .get("/:kind", (c) => c.json(livingDetail(deps(c), parse(kindParam, c.req.param()).kind)))
  .get("/:kind/cover", async (c) => {
    const { kind } = parse(kindParam, c.req.param());
    const key = livingCoverKey(kind);
    const headers = { etag: `"${key}"`, "cache-control": c.req.query("v") === key ? "private, max-age=31536000, immutable" : "private, no-cache" };
    if (c.req.header("if-none-match") === headers.etag) return c.body(null, 304, headers);
    return c.body(new Uint8Array(await livingCover(kind)), 200, { ...headers, "content-type": "image/jpeg" });
  })
  .get("/:kind/refreshes/:id", (c) => {
    const p = parse(kindParam.extend({ id: z.coerce.number().int().min(1) }), c.req.param());
    const refresh = livingRefresh(c.var.deps.db, p.kind, p.id);
    if (!refresh) throw new ApiError(404, "not_found", "Not found");
    return c.json(refresh);
  })
  .patch("/:kind", async (c) => {
    const { kind } = parse(kindParam, c.req.param());
    const body = parse(z.object({ enabled: z.boolean() }).strict(), await jsonBody(c));
    const outcome = await setLivingEnabled(deps(c), kind, body.enabled);
    return c.json({ outcome, playlist: livingDetail(deps(c), kind) });
  })
  .post("/:kind/refresh", async (c) => {
    const { kind } = parse(kindParam, c.req.param());
    const outcome = await refreshLiving(deps(c), kind, "manual");
    return c.json({ outcome, playlist: livingDetail(deps(c), kind) });
  });
