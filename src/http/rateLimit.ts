import type { MiddlewareHandler } from "hono";
import type { Env } from "./context";
import { ApiError } from "./errors";

const MAX_CLIENTS = 10_000;

export function rateLimit(limit: number, windowMs: number): MiddlewareHandler<Env> {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return async (c, next) => {
    const now = c.var.deps.now();
    const client = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    let window = windows.get(client);
    if (!window || now - window.startedAt >= windowMs) {
      windows.delete(client);
      if (windows.size >= MAX_CLIENTS) windows.delete(windows.keys().next().value!);
      window = { startedAt: now, count: 0 };
      windows.set(client, window);
    }
    window.count++;
    if (window.count > limit) {
      c.header("Retry-After", String(Math.ceil((window.startedAt + windowMs - now) / 1000)));
      throw new ApiError(429, "rate_limited", "Too many attempts. Try again in a minute.");
    }
    await next();
  };
}
