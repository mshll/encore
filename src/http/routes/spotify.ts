import { Hono } from "hono";
import { runJob } from "../../jobs/scheduler";
import { getJobState } from "../../jobs/state";
import { SpotifyAuthError } from "../../spotify/errors";
import type { Env } from "../context";
import { ApiError } from "../errors";

export const spotifyRoutes = new Hono<Env>()
  .get("/authorize", (c) => c.json({ url: c.var.deps.spotifyAuth.createAuthorizeUrl() }))
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
  const back = (result: string) => c.redirect(`${config.publicBaseUrl}/?spotify=${result}`);
  const code = c.req.query("code");
  const state = c.req.query("state");
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
