import { Hono } from "hono";
import { z } from "zod";
import { ALERTS_JOB, NoAlertChannelsError } from "../../alerts/monitor";
import { BACKUP_JOB } from "../../backup/service";
import { EXPORT_FORMATS, exportStream } from "../../export/plays";
import { getJobState, type JobState } from "../../jobs/state";
import { runJob } from "../../jobs/scheduler";
import { localTime } from "../../plays/localTime";
import type { Env } from "../context";
import { ApiError, parse } from "../errors";

const iso = (ts: number | null | undefined) => (ts ? new Date(ts).toISOString() : null);
const job = (state: JobState | undefined) => ({ lastRunAt: iso(state?.lastRunAt), lastSuccessAt: iso(state?.lastSuccessAt), lastError: state?.lastError ?? null });

const downloadQuery = z.object({ from: z.enum(["local", "remote"]).default("local") });
const exportQuery = z.object({ format: z.enum(EXPORT_FORMATS).default("csv") });

const attachment = (name: string) => `attachment; filename="${name}"`;

export const backupRoutes = new Hono<Env>()
  .get("/", async (c) => {
    const { db, ops } = c.var.deps;
    const remote = await ops.backups.remoteFiles();
    return c.json({
      local: ops.backups.localFiles(),
      remote: remote && remote.files,
      remoteError: remote?.error ?? null,
      running: ops.backups.running,
      job: job(getJobState(db, BACKUP_JOB)),
    });
  })
  .post("/", async (c) => {
    const { db, ops } = c.var.deps;
    if (ops.backups.running) throw new ApiError(409, "backup_running", "A backup is already running");
    await runJob(db, ops.backups.job());
    const state = getJobState(db, BACKUP_JOB);
    if (state?.lastError) throw new ApiError(502, "backup_failed", state.lastError);
    return c.json({ backup: state?.data ?? null, job: job(state) });
  })
  .get("/:name/download", async (c) => {
    const { ops } = c.var.deps;
    const name = c.req.param("name");
    const { from } = parse(downloadQuery, c.req.query());
    const local = from === "local" ? ops.backups.localPath(name) : null;
    const body = from === "local" ? local && Bun.file(local).stream() : await ops.backups.remoteStream(name);
    if (!body) throw new ApiError(404, "backup_not_found", "No backup with that name");
    return new Response(body, { headers: { "content-type": "application/vnd.sqlite3", "content-disposition": attachment(name), "cache-control": "no-store" } });
  });

export const exportRoutes = new Hono<Env>().get("/plays", (c) => {
  const { db, settings, now } = c.var.deps;
  const { format } = parse(exportQuery, c.req.query());
  const day = localTime(now(), settings.get().timezone).day;
  return new Response(exportStream(db, format), {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "content-disposition": attachment(`encore-plays-${day}.${format}`),
      "cache-control": "no-store",
    },
  });
});

export const alertRoutes = new Hono<Env>()
  .get("/", (c) => {
    const { db, ops } = c.var.deps;
    return c.json({
      channels: ops.alerts.channels().map((ch) => ch.name),
      open: ops.alerts.open().map((i) => ({ key: i.key, title: i.title, since: iso(i.since) })),
      job: job(getJobState(db, ALERTS_JOB)),
    });
  })
  .post("/test", async (c) => {
    try {
      return c.json({ results: await c.var.deps.ops.alerts.sendTest() });
    } catch (error) {
      if (error instanceof NoAlertChannelsError) throw new ApiError(409, "alerts_not_configured", error.message);
      throw error;
    }
  });
