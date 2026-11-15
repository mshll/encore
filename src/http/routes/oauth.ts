import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { MCP_TOOLS } from "../../mcp/server";
import { MCP_SCOPE, OAuthError, SCOPES, type OAuthServer } from "../../oauth/server";
import type { Env } from "../context";
import { ApiError, errorResponse, jsonBody, parse } from "../errors";

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

const oauthErrorResponse = (error: unknown, c: Context<Env>) =>
  error instanceof OAuthError ? c.json({ error: error.code, error_description: error.message }, error.status, NO_STORE) : errorResponse(c, error);

const requireOAuth = async (c: Context<Env>, next: () => Promise<void>) => {
  if (!c.var.deps.settings.get().mcpOAuth) throw new ApiError(404, "not_found", "MCP OAuth is off");
  await next();
};

async function formBody(c: Context<Env>): Promise<Record<string, string>> {
  const type = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") throw new OAuthError("invalid_request", "Body must be application/x-www-form-urlencoded");
  const body = await c.req.parseBody();
  return Object.fromEntries(Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

const errorPage = (message: string) => `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Cannot connect · encore</title>
<body style="font: 16px/1.5 system-ui, sans-serif; max-width: 32rem; margin: 15vh auto 0; padding: 0 16px">
<h1 style="font-size: 1.25rem">This connection cannot continue</h1>
<p>${message}</p>
</body>
</html>`;

/** RFC 9728 and RFC 8414 discovery documents, served under `/.well-known`. */
export function wellKnownRoutes(oauth: OAuthServer) {
  const resourceMetadata = (c: Context<Env>) =>
    c.json({ resource: oauth.resource, authorization_servers: [oauth.issuer], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ["header"], resource_name: "encore" });
  return new Hono<Env>()
    .use("*", cors(), requireOAuth)
    .get("/oauth-protected-resource", resourceMetadata)
    .get("/oauth-protected-resource/mcp", resourceMetadata)
    .get("/oauth-authorization-server", (c) =>
      c.json({
        issuer: oauth.issuer,
        authorization_endpoint: `${oauth.issuer}/oauth/authorize`,
        token_endpoint: `${oauth.issuer}/oauth/token`,
        registration_endpoint: `${oauth.issuer}/oauth/register`,
        revocation_endpoint: `${oauth.issuer}/oauth/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        revocation_endpoint_auth_methods_supported: ["none"],
        scopes_supported: SCOPES,
        authorization_response_iss_parameter_supported: true,
      }),
    );
}

/** The public OAuth endpoints MCP clients call: registration, authorization, token, revocation. */
export function oauthRoutes(oauth: OAuthServer) {
  return new Hono<Env>()
    .onError(oauthErrorResponse)
    .use("*", requireOAuth)
    .use("/register", cors())
    .use("/token", cors())
    .use("/revoke", cors())
    .post("/register", async (c) => {
      const type = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (type !== "application/json") throw new OAuthError("invalid_client_metadata", "Body must be application/json");
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        throw new OAuthError("invalid_client_metadata", "Body must be JSON");
      }
      return c.json(oauth.register(body), 201, NO_STORE);
    })
    .get("/authorize", (c) => {
      const outcome = oauth.authorize(c.req.query());
      if (outcome.kind === "consent") return c.redirect(`/connect/${outcome.requestId}`, 302);
      if (outcome.kind === "redirect") return c.redirect(outcome.location, 302);
      return c.html(errorPage(outcome.message), 400);
    })
    .post("/token", async (c) => c.json(oauth.token(await formBody(c)), 200, NO_STORE))
    .post("/revoke", async (c) => {
      oauth.revoke(await formBody(c));
      return c.body(null, 200);
    });
}

const decisionBody = z.object({ decision: z.enum(["allow", "deny"]) });

/** Session routes for the consent page and the list of connected clients in Settings. */
export function mcpAccessRoutes(oauth: OAuthServer) {
  const requestOf = (c: Context<Env>) => {
    const request = c.var.deps.settings.get().mcpOAuth ? oauth.consentRequest(c.req.param("id") ?? "") : null;
    if (!request) throw new ApiError(404, "oauth_request_not_found", "This connection request expired or was already answered");
    return request;
  };
  return new Hono<Env>()
    .get("/requests/:id", (c) => c.json({ ...requestOf(c), tools: MCP_TOOLS }))
    .post("/requests/:id", async (c) => {
      const { decision } = parse(decisionBody, await jsonBody(c));
      requestOf(c);
      const redirectTo = oauth.decide(c.req.param("id"), decision === "allow");
      if (!redirectTo) throw new ApiError(404, "oauth_request_not_found", "This connection request expired or was already answered");
      return c.json({ redirectTo });
    })
    .get("/connections", (c) =>
      c.json({
        connections: oauth.connections().map((x) => ({
          ...x,
          connectedAt: new Date(x.connectedAt).toISOString(),
          lastUsedAt: x.lastUsedAt === null ? null : new Date(x.lastUsedAt).toISOString(),
        })),
      }),
    )
    .delete("/connections/:id", (c) => {
      const id = Number(c.req.param("id"));
      if (!Number.isInteger(id) || !oauth.disconnect(id)) throw new ApiError(404, "not_found", "No such connection");
      return c.json({ disconnected: true });
    });
}
