import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { secureHeaders } from "hono/secure-headers";
import { API_BODY_BYTES, limitBody, PRE_AUTH_BODY_BYTES } from "./bodyLimits";
import type { Deps, Env } from "./context";
import { ApiError, errorResponse } from "./errors";
import { guardWrites, requireSession, requireSessionOrAdmin } from "./middleware";
import { rateLimit } from "./rateLimit";
import { authRoutes } from "./routes/auth";
import { askRoutes, blockRoutes, digestRoutes, llmRoutes, noteRoutes, pickRoutes, setRoutes } from "./routes/assistant";
import { cleanupRoutes } from "./routes/cleanup";
import { discordRoutes } from "./routes/discord";
import { djRoutes } from "./routes/dj";
import { importRoutes } from "./routes/imports";
import { libraryRoutes } from "./routes/library";
import { mcpRoutes } from "./routes/mcp";
import { onboardingRoutes } from "./routes/onboarding";
import { playerRoutes } from "./routes/player";
import { radarRoutes } from "./routes/radar";
import { runRoutes } from "./routes/runs";
import { callbackRoute, spotifyRoutes } from "./routes/spotify";
import { entityRoutes, historyRoutes, searchRoutes, statsRoutes } from "./routes/stats";
import { settingsRoutes } from "./routes/settings";
import { statusRoutes } from "./routes/status";
import { tagRoutes } from "./routes/tags";
import { trackRoutes } from "./routes/tracks";

export function createApp(deps: Deps) {
  const app = new Hono<Env>();
  app.use(async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  app.onError((error, c) => errorResponse(c, error));
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
      strictTransportSecurity: deps.config.secureCookies ? "max-age=31536000" : false,
      referrerPolicy: "same-origin",
    }),
  );
  app.use("/api/*", async (c, next) => {
    await next();
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });

  const authLimit = rateLimit(20, 60_000);
  const preAuthLimit = limitBody(PRE_AUTH_BODY_BYTES);
  const apiLimit = limitBody(API_BODY_BYTES);
  app.use("/mcp", preAuthLimit);
  app.use("/api/*", (c, next) => {
    if (c.req.path === "/api/import") return next();
    return (c.req.path.startsWith("/api/auth/") || c.req.path.startsWith("/api/discord/") ? preAuthLimit : apiLimit)(c, next);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/discord", discordRoutes);
  app.use("/api/*", guardWrites(["/api/import"]));
  app.use("/api/auth/*", async (c, next) => (c.req.method === "GET" ? next() : authLimit(c, next)));
  app.route("/api/auth", authRoutes);
  app.route("/", callbackRoute);
  app.route("/mcp", mcpRoutes(deps));

  app.use("/api/tags/*", requireSessionOrAdmin);
  app.route("/api/tags", tagRoutes);
  app.use("/api/import", requireSessionOrAdmin);
  app.use("/api/import/*", requireSessionOrAdmin);
  app.route("/api/import", importRoutes);

  app.use("/api/*", requireSession);
  app.route("/api/status", statusRoutes);
  app.route("/api/settings", settingsRoutes);
  app.route("/api/onboarding", onboardingRoutes);
  app.route("/api/spotify", spotifyRoutes);
  app.route("/api/stats", statsRoutes);
  app.route("/api/entities", entityRoutes);
  app.route("/api/history", historyRoutes);
  app.route("/api/search", searchRoutes);
  app.route("/api/sets", setRoutes);
  app.route("/api/picks", pickRoutes);
  app.route("/api/blocks", blockRoutes);
  app.route("/api/ask", askRoutes);
  app.route("/api/notes", noteRoutes);
  app.route("/api/digests", digestRoutes);
  app.route("/api/llm", llmRoutes);
  app.route("/api/runs", runRoutes);
  app.route("/api/player", playerRoutes);
  app.route("/api/tracks", trackRoutes);
  app.route("/api/dj", djRoutes);
  app.route("/api/radar", radarRoutes);
  app.route("/api/cleanup", cleanupRoutes);
  app.route("/api/library", libraryRoutes);
  app.all("/api/*", () => {
    throw new ApiError(404, "not_found", "Unknown API route");
  });

  if (existsSync(join(deps.config.webDist, "index.html"))) {
    app.use("*", serveStatic({ root: deps.config.webDist }));
    // `path` is joined onto `root` (default "./"), so an absolute WEB_DIST must go in `root`.
    app.get("*", serveStatic({ root: deps.config.webDist, path: "index.html" }));
  }
  return app;
}
