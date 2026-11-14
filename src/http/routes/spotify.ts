import { Hono } from "hono";
import { z } from "zod";
import { runJob } from "../../jobs/scheduler";
import { getJobState } from "../../jobs/state";
import { SpotifyAuthError } from "../../spotify/errors";
import type { Env } from "../context";
import { ApiError, parse } from "../errors";

/** Where the callback sends the browser, by the `return` the flow started with. A fixed list, never a URL from the request. */
const RETURNS = {
  setup: { path: "/setup", query: { step: "spotifyConnect" } },
  settings: { path: "/settings/spotify", query: {} },
} as const;
type ReturnTo = keyof typeof RETURNS;
const isReturn = (tag: string | undefined): tag is ReturnTo => tag === "setup" || tag === "settings";

export const spotifyRoutes = new Hono<Env>()
  .get("/authorize", (c) => {
    const q = parse(z.object({ return: z.enum(["setup", "settings"]).default("settings") }), c.req.query());
    return c.json({ url: c.var.deps.spotifyAuth.createAuthorizeUrl(q.return) });
  })
  .post("/disconnect", (c) => {
    c.var.deps.spotifyAuth.disconnect();
    return c.json({ connected: false });
  })
  .post("/poll", async (c) => {
    const { db, jobs, spotifyAuth } = c.var.deps;
    if (!spotifyAuth.status().connected) throw new ApiError(409, "spotify_not_connected", "Connect Spotify first");
    await runJob(db, jobs.poll);
    const state = getJobState(db, "poll");
    if (state?.lastError) throw new ApiError(502, "poll_failed", state.lastError);
    return c.json(state?.data ?? {});
  });

export const callbackRoute = new Hono<Env>().get("/callback", async (c) => {
  const { spotifyAuth, spotify, config } = c.var.deps;
  const code = c.req.query("code");
  const state = c.req.query("state");
  const tag = state?.split(".")[0];
  const to = RETURNS[isReturn(tag) ? tag : "settings"];
  const back = (result: string) => c.redirect(`${config.publicBaseUrl}${to.path}?${new URLSearchParams({ ...to.query, spotify: result })}`);
  if (!code || !state) return back("denied");
  try {
    await spotifyAuth.completeAuthorization(code, state);
  } catch (error) {
    if (!(error instanceof SpotifyAuthError)) throw error;
    console.error(`Spotify authorization failed: ${error.message}`);
    return back("error");
  }
  try {
    spotifyAuth.setUserId((await spotify.me()).id);
  } catch (error) {
    console.error(`Spotify /me lookup failed: ${error instanceof Error ? error.message : error}`);
  }
  return back("connected");
});
