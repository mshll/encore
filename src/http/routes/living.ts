import { Hono } from "hono";
import { z } from "zod";
import { livingCover, livingCoverKey } from "../../living/cover";
import { specOf } from "../../living/kinds";
import { createRulePlaylist, deleteRulePlaylist, previewRule, ruleInputSchema, setLivingFrozen, updateRulePlaylist } from "../../living/manage";
import { refreshLiving, requireLivingRow, setLivingEnabled, type LivingDeps } from "../../living/refresh";
import { ruleSchema } from "../../living/rules";
import { livingDetail, livingList, livingRefresh } from "../../living/view";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";

const kindParam = z.object({ kind: z.string().regex(/^[a-z0-9-]{1,40}$/) });

const deps = (c: { var: Env["Variables"] }): LivingDeps => {
  const { db, spotify, settings, now } = c.var.deps;
  return { db, spotify, settings, now };
};

export const livingRoutes = new Hono<Env>()
  .get("/", (c) => c.json(livingList(deps(c))))
  .post("/", async (c) => {
    const body = parse(ruleInputSchema, await jsonBody(c));
    const id = createRulePlaylist(c.var.deps.db, body, c.var.deps.now());
    return c.json({ playlist: livingDetail(deps(c), id) }, 201);
  })
  .post("/preview", async (c) => {
    const { rule } = parse(z.strictObject({ rule: ruleSchema }), await jsonBody(c));
    return c.json(previewRule(deps(c), rule));
  })
  .get("/:kind", (c) => c.json(livingDetail(deps(c), parse(kindParam, c.req.param()).kind)))
  .get("/:kind/cover", async (c) => {
    const { kind } = parse(kindParam, c.req.param());
    const spec = specOf(requireLivingRow(c.var.deps.db, kind, c.var.deps.now()));
    const key = livingCoverKey(spec);
    const headers = { etag: `"${key}"`, "cache-control": c.req.query("v") === key ? "private, max-age=31536000, immutable" : "private, no-cache" };
    if (c.req.header("if-none-match") === headers.etag) return c.body(null, 304, headers);
    return c.body(new Uint8Array(await livingCover(spec)), 200, { ...headers, "content-type": "image/jpeg" });
  })
  .get("/:kind/refreshes/:id", (c) => {
    const p = parse(kindParam.extend({ id: z.coerce.number().int().min(1) }), c.req.param());
    const refresh = livingRefresh(c.var.deps.db, p.kind, p.id);
    if (!refresh) throw new ApiError(404, "not_found", "Not found");
    return c.json(refresh);
  })
  .put("/:kind", async (c) => {
    const { kind } = parse(kindParam, c.req.param());
    const body = parse(ruleInputSchema, await jsonBody(c));
    const outcome = await updateRulePlaylist(deps(c), kind, body);
    return c.json({ outcome, playlist: livingDetail(deps(c), kind) });
  })
  .patch("/:kind", async (c) => {
    const { kind } = parse(kindParam, c.req.param());
    const body = parse(
      z.strictObject({ enabled: z.boolean().optional(), frozen: z.boolean().optional() }).refine((b) => b.enabled !== undefined || b.frozen !== undefined, { message: "Send enabled or frozen" }),
      await jsonBody(c),
    );
    if (body.frozen !== undefined) setLivingFrozen(c.var.deps.db, kind, body.frozen, c.var.deps.now());
    const outcome = body.enabled === undefined ? null : await setLivingEnabled(deps(c), kind, body.enabled);
    return c.json({ outcome, playlist: livingDetail(deps(c), kind) });
  })
  .delete("/:kind", (c) => {
    const { kind } = parse(kindParam, c.req.param());
    const kept = deleteRulePlaylist(c.var.deps.db, kind, c.var.deps.now());
    return c.json({ deleted: true, spotifyPlaylist: kept });
  })
  .post("/:kind/refresh", async (c) => {
    const { kind } = parse(kindParam, c.req.param());
    const outcome = await refreshLiving(deps(c), kind, "manual");
    return c.json({ outcome, playlist: livingDetail(deps(c), kind) });
  });
