import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { safeEqual } from "../auth/secrets";
import { isValidSession } from "../auth/sessions";
import type { Env } from "./context";
import { ApiError } from "./errors";

export const sessionCookie = (c: Context<Env>) => (c.var.deps.config.secureCookies ? "__Host-encore_session" : "encore_session");

export function hasSession(c: Context<Env>): boolean {
  const { db, now } = c.var.deps;
  return isValidSession(db, getCookie(c, sessionCookie(c)), now());
}

function hasAdminToken(c: Context<Env>): boolean {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  return safeEqual(token, c.var.deps.settings.get().adminToken);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isSameOrigin(c: Context<Env>): boolean {
  const origin = c.req.header("origin");
  if (origin !== undefined) return origin === new URL(c.var.deps.config.publicBaseUrl).origin;
  const site = c.req.header("sec-fetch-site");
  return site === undefined || site === "same-origin" || site === "none";
}

const hasBody = (c: Context<Env>) => c.req.raw.body !== null && c.req.header("content-length") !== "0";

/**
 * Cookie-authenticated writes must come from the app's own origin and carry JSON, so a page on a sibling
 * subdomain (same site, so the Lax cookie is sent) cannot post a form or a text/plain fetch.
 */
export const guardWrites = (multipartPaths: string[]): MiddlewareHandler<Env> => async (c, next) => {
  if (SAFE_METHODS.has(c.req.method) || hasAdminToken(c)) return next();
  if (!isSameOrigin(c)) throw new ApiError(403, "cross_origin_rejected", "Cross-origin request rejected");
  if (hasBody(c) && !multipartPaths.includes(c.req.path)) {
    const type = c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") throw new ApiError(415, "json_required", "Request body must be application/json");
  }
  await next();
};

export const requireSession: MiddlewareHandler<Env> = async (c, next) => {
  if (!hasSession(c)) throw new ApiError(401, "unauthenticated", "Sign in required");
  await next();
};

export const requireSessionOrAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (!hasAdminToken(c) && !hasSession(c)) throw new ApiError(401, "unauthenticated", "Sign in or admin token required");
  await next();
};
