import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import { NoActiveDeviceError, PremiumRequiredError } from "../player/api";
import { SpotifyApiError, SpotifyBlockedError, SpotifyNotConfiguredError, SpotifyNotConnectedError } from "../spotify/errors";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new ApiError(400, "invalid_request", "Request validation failed", details);
  }
  return result.data;
}

export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be JSON");
  }
}

function spotifyError(error: unknown): ApiError | null {
  if (error instanceof NoActiveDeviceError) return new ApiError(409, "no_active_device", "No active Spotify device");
  if (error instanceof PremiumRequiredError) return new ApiError(403, "premium_required", "Spotify Premium is required");
  if (error instanceof SpotifyNotConfiguredError) return new ApiError(409, "spotify_not_configured", "Set the Spotify client id first");
  if (error instanceof SpotifyNotConnectedError) return new ApiError(409, "spotify_not_connected", "Connect Spotify first");
  if (error instanceof SpotifyBlockedError) return new ApiError(503, "spotify_paused", error.message, { reason: error.reason, until: new Date(error.blockedUntil).toISOString() });
  if (error instanceof SpotifyApiError) return new ApiError(502, "spotify_failed", error.message);
  return null;
}

export function errorResponse(c: Context, raw: unknown) {
  const error = spotifyError(raw) ?? raw;
  if (error instanceof ApiError) {
    return c.json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, error.status);
  }
  console.error(error);
  return c.json({ error: { code: "internal", message: "Internal server error" } }, 500);
}
