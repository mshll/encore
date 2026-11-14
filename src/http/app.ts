import { existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { Deps, Env } from "./context";
import { ApiError, errorResponse } from "./errors";
import { requireSession, requireSessionOrAdmin } from "./middleware";
import { authRoutes } from "./routes/auth";
import { askRoutes, blockRoutes, digestRoutes, llmRoutes, noteRoutes, pickRoutes, setRoutes } from "./routes/assistant";
import { cleanupRoutes } from "./routes/cleanup";
import { discordRoutes } from "./routes/discord";
import { djRoutes } from "./routes/dj";
import { importRoutes } from "./routes/imports";
import { mcpRoutes } from "./routes/mcp";
import { playerRoutes } from "./routes/player";
import { radarRoutes } from "./routes/radar";
import { callbackRoute, spotifyRoutes } from "./routes/spotify";
import { entityRoutes, historyRoutes, searchRoutes, statsRoutes } from "./routes/stats";
import { statusRoutes } from "./routes/status";
import { tagRoutes } from "./routes/tags";

export function createApp(deps: Deps) {
  const app = new Hono<Env>();
  app.use(async (c, next) => {
    c.set("deps", deps);
    await next();
  });
  app.onError((error, c) => errorResponse(c, error));

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/auth", authRoutes);
  app.route("/", callbackRoute);
  app.route("/api/discord", discordRoutes);
  app.route("/mcp", mcpRoutes(deps));

  app.use("/api/tags/*", requireSessionOrAdmin);
  app.route("/api/tags", tagRoutes);
  app.use("/api/import", requireSessionOrAdmin);
  app.route("/api/import", importRoutes);

  app.use("/api/*", requireSession);
  app.route("/api/status", statusRoutes);
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
  app.route("/api/player", playerRoutes);
  app.route("/api/dj", djRoutes);
  app.route("/api/radar", radarRoutes);
  app.route("/api/cleanup", cleanupRoutes);
  app.all("/api/*", () => {
    throw new ApiError(404, "not_found", "Unknown API route");
  });

  if (existsSync(join(deps.config.webDist, "index.html"))) {
    app.use("*", serveStatic({ root: deps.config.webDist }));
    app.get("*", serveStatic({ path: join(deps.config.webDist, "index.html") }));
  }
  return app;
}
