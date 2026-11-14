import { Hono } from "hono";
import { z } from "zod";
import { getJobState } from "../../jobs/state";
import { localTime } from "../../plays/localTime";
import { listReleases, markReleasesSeen, radarStatus } from "../../radar/radar";
import type { Env } from "../context";
import { jsonBody, parse } from "../errors";

export const radarRoutes = new Hono<Env>()
  .get("/", (c) => {
    const { db, config, now } = c.var.deps;
    const q = parse(
      z.object({ status: z.enum(["new", "recent"]).default("new"), days: z.coerce.number().int().min(1).max(365).default(30), limit: z.coerce.number().int().min(1).max(200).default(50) }),
      c.req.query(),
    );
    const today = localTime(now(), config.timezone).day;
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - q.days * 86_400_000).toISOString().slice(0, 10);
    const job = getJobState(db, "radar");
    return c.json({
      ...radarStatus(db, config, now()),
      lastRunAt: job?.lastRunAt ? new Date(job.lastRunAt).toISOString() : null,
      lastResult: job?.data ?? null,
      items: listReleases(db, { status: q.status, since, limit: q.limit }),
    });
  })
  .post("/seen", async (c) => {
    const body = parse(z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(500).optional() }).strict(), await jsonBody(c));
    return c.json({ marked: markReleasesSeen(c.var.deps.db, body.ids, c.var.deps.now()) });
  });
