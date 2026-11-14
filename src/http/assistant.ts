import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { DigestNotFoundError } from "../digest/service";
import { ThreadNotFoundError } from "../ask/service";
import type { AgentEvent } from "../llm/agent";
import type { FeatureContext } from "../llm/context";
import { LlmBudgetExceededError, LlmIncompleteError, LlmNotConfiguredError, LlmRefusalError, LlmTruncatedError } from "../llm/errors";
import { NoteSubjectNotFoundError } from "../notes/service";
import { PicksExistError, PicksNotSubmittedError } from "../picks/service";
import { PickNotFoundError } from "../picks/state";
import { EmptySetError } from "../sets/playlist";
import { SetNotBuiltError, SetNotFoundError } from "../sets/service";
import { SpotifyApiError, SpotifyBlockedError, SpotifyNotConnectedError } from "../spotify/errors";
import type { Env } from "./context";
import { ApiError } from "./errors";

export function toApiError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (error instanceof LlmNotConfiguredError) return new ApiError(503, "llm_not_configured", error.message);
  if (error instanceof LlmBudgetExceededError)
    return new ApiError(402, "llm_budget_exceeded", error.message, { month: error.month, spentUsd: Math.round(error.spentUsd * 100) / 100, capUsd: error.capUsd });
  if (error instanceof LlmRefusalError) return new ApiError(422, "llm_refused", error.message, { category: error.category });
  if (error instanceof LlmTruncatedError || error instanceof LlmIncompleteError || error instanceof SetNotBuiltError || error instanceof PicksNotSubmittedError)
    return new ApiError(502, "llm_incomplete", error.message);
  if (error instanceof Anthropic.APIError) return new ApiError(502, "llm_failed", `Claude API error ${error.status ?? ""}`.trim());
  if (error instanceof SpotifyNotConnectedError) return new ApiError(409, "spotify_not_connected", error.message);
  if (error instanceof SpotifyBlockedError) return new ApiError(503, "spotify_paused", error.message, { reason: error.reason, until: new Date(error.blockedUntil).toISOString() });
  if (error instanceof SpotifyApiError) return new ApiError(502, "spotify_failed", error.message);
  if (error instanceof SetNotFoundError || error instanceof ThreadNotFoundError || error instanceof PickNotFoundError || error instanceof DigestNotFoundError)
    return new ApiError(404, "not_found", "Not found");
  if (error instanceof NoteSubjectNotFoundError) return new ApiError(404, "not_found", error.message);
  if (error instanceof PicksExistError) return new ApiError(409, "picks_exist", error.message, { week: error.week });
  if (error instanceof EmptySetError) return new ApiError(409, "set_empty", error.message);
  return error;
}

export async function mapped<T>(run: () => Promise<T> | T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toApiError(error);
  }
}

export function featureContext(c: Context<Env>): FeatureContext {
  const { db, config, llm, spotify, now } = c.var.deps;
  return { db, config, llm, spotify, now };
}

const wantsStream = (c: Context) => c.req.header("accept")?.includes("text/event-stream") ?? false;

/**
 * JSON by default. With `Accept: text/event-stream` the response is SSE: `text` and `tool` events while
 * Claude works, then one `done` event with the same body the JSON response would have, or one `error` event.
 */
export async function respond<T>(c: Context<Env>, run: (onEvent?: (e: AgentEvent) => void) => Promise<T>, status: 200 | 201 = 200) {
  if (!wantsStream(c)) return c.json((await mapped(() => run())) as object, status);
  await mapped(() => c.var.deps.llm.assertAvailable());
  return streamSSE(c, async (stream) => {
    let chain = Promise.resolve();
    const send = (event: string, data: unknown) => {
      chain = chain.then(() => stream.writeSSE({ event, data: JSON.stringify(data) }));
    };
    try {
      const result = await run((e) => (e.type === "text" ? send("text", { delta: e.delta }) : send("tool", { name: e.name, input: e.input })));
      send("done", result);
    } catch (error) {
      const api = toApiError(error);
      if (!(api instanceof ApiError)) console.error(error);
      send("error", { error: api instanceof ApiError ? { code: api.code, message: api.message, ...(api.details ? { details: api.details } : {}) } : { code: "internal", message: "Internal server error" } });
    }
    await chain;
  });
}
