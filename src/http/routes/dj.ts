import { Hono } from "hono";
import { z } from "zod";
import { InvalidSetError, MAX_SET_SIZE, type DjSession } from "../../dj/session";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";

const iso = (ts: number | null) => (ts === null ? null : new Date(ts).toISOString());

export function djSessionView(s: DjSession | undefined) {
  if (!s) return null;
  return {
    id: s.id,
    status: s.status,
    playlistUri: `spotify:playlist:${s.playlistId}`,
    position: s.position,
    current: s.uris[s.position] ?? null,
    upcoming: s.uris.slice(s.position + 1),
    played: s.outcomes,
    skipStreak: s.skipStreak,
    replans: s.replans,
    startedAt: iso(s.startedAt),
    endedAt: iso(s.endedAt),
    endReason: s.endReason,
  };
}

export const djRoutes = new Hono<Env>()
  .get("/", (c) => {
    const { dj } = c.var.deps.services;
    return c.json({ session: djSessionView(dj.active() ?? dj.latest()) });
  })
  .post("/start", async (c) => {
    const body = parse(z.object({ uris: z.array(z.string()).min(1).max(MAX_SET_SIZE), deviceId: z.string().min(1).max(100).optional() }).strict(), await jsonBody(c));
    try {
      return c.json({ session: djSessionView(await c.var.deps.services.dj.start(body.uris, body.deviceId)) });
    } catch (error) {
      if (error instanceof InvalidSetError) throw new ApiError(400, "invalid_set", error.message);
      throw error;
    }
  })
  .post("/stop", (c) => {
    const stopped = c.var.deps.services.dj.stop();
    if (!stopped) throw new ApiError(404, "not_found", "No active session");
    return c.json({ session: djSessionView(stopped) });
  });
