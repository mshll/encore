import { Hono } from "hono";
import { z } from "zod";
import { followRun } from "../assistant";
import type { Env } from "../context";
import { ApiError, parse } from "../errors";
import { runs } from "../runs";

const find = (id: string) => {
  const run = runs.get(id);
  if (!run) throw new ApiError(404, "not_found", "Not found");
  return run;
};

export const runRoutes = new Hono<Env>()
  .get("/", (c) => {
    const { key } = parse(z.object({ key: z.string().min(1).max(200) }), c.req.query());
    const run = runs.active(key);
    return c.json({ run: run ? { id: run.id, startedAt: new Date(run.startedAt).toISOString() } : null });
  })
  .get("/:id/events", (c) => followRun(c, find(c.req.param("id"))))
  .delete("/:id", (c) => {
    find(c.req.param("id")).cancel(c.var.deps.now());
    return c.json({ cancelled: true });
  });
