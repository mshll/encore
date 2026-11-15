import { Hono } from "hono";
import { safeEqual } from "../../auth/secrets";
import { createMcpEndpoint } from "../../mcp/server";
import { MCP_SCOPE, type OAuthServer } from "../../oauth/server";
import type { Deps, Env } from "../context";
import { ApiError } from "../errors";

/** `/mcp` takes the static MCP token or, with OAuth on, an access token issued for it. Off when neither is set up. */
export function mcpRoutes(deps: Deps, oauth: OAuthServer) {
  const endpoint = createMcpEndpoint(deps);
  const resourceMetadataUrl = `${oauth.issuer}/.well-known/oauth-protected-resource/mcp`;
  return new Hono<Env>().all("/", async (c) => {
    const { mcpToken, mcpOAuth } = deps.settings.get();
    if (!mcpToken && !mcpOAuth) throw new ApiError(404, "not_found", "MCP is disabled");
    const header = c.req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (safeEqual(bearer, mcpToken)) return endpoint.fetch(c.req.raw);
    const grant = mcpOAuth && bearer ? oauth.verifyAccessToken(bearer) : null;
    if (grant) {
      return endpoint.fetch(c.req.raw, {
        authInfo: { token: bearer!, clientId: grant.clientId, scopes: grant.scope.split(" "), expiresAt: Math.floor(grant.expiresAt / 1000), resource: new URL(grant.resource) },
      });
    }
    if (!mcpOAuth) throw new ApiError(401, "unauthenticated", "MCP token required");
    const challenge = `Bearer resource_metadata="${resourceMetadataUrl}", scope="${MCP_SCOPE}"${bearer ? `, error="invalid_token"` : ""}`;
    return c.json({ error: { code: "unauthenticated", message: "Sign in through OAuth or send the MCP token" } }, 401, { "WWW-Authenticate": challenge });
  });
}
