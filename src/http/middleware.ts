import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { safeEqual } from "../auth/secrets";
import { isValidSession } from "../auth/sessions";
import type { Env } from "./context";
import { ApiError } from "./errors";

export const SESSION_COOKIE = "encore_session";

export function hasSession(c: Context<Env>): boolean {
  const { db, now } = c.var.deps;
  return isValidSession(db, getCookie(c, SESSION_COOKIE), now());
}

function hasAdminToken(c: Context<Env>): boolean {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  return safeEqual(token, c.var.deps.config.adminToken);
}

export const requireSession: MiddlewareHandler<Env> = async (c, next) => {
  if (!hasSession(c)) throw new ApiError(401, "unauthenticated", "Sign in required");
  await next();
};

export const requireSessionOrAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (!hasAdminToken(c) && !hasSession(c)) throw new ApiError(401, "unauthenticated", "Sign in or admin token required");
  await next();
};
