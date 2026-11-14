import { Hono } from "hono";
import { safeEqual } from "../../auth/secrets";
import { createMcpEndpoint } from "../../mcp/server";
import type { Deps, Env } from "../context";
import { ApiError } from "../errors";

export function mcpRoutes(deps: Deps) {
  const token = deps.config.mcpToken;
  const endpoint = token ? createMcpEndpoint(deps) : null;
  return new Hono<Env>().all("/", async (c) => {
    if (!token || !endpoint) throw new ApiError(404, "not_found", "MCP is disabled");
    const header = c.req.header("authorization");
    if (!safeEqual(header?.startsWith("Bearer ") ? header.slice(7) : undefined, token)) throw new ApiError(401, "unauthenticated", "MCP token required");
    return endpoint.fetch(c.req.raw);
  });
}
