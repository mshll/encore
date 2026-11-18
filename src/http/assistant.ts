import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { EmptyRecapPlaylistError } from "../digest/playlist";
import { DigestNotFoundError, RecapPeriodError } from "../digest/service";
import { PlanNotFoundError } from "../library/plans";
import { PlanNotBuiltError } from "../library/planner";
import { StandingNotFoundError } from "../library/standing";
import { ThreadNotFoundError } from "../ask/service";
import type { AgentEvent } from "../llm/agent";
import type { FeatureContext } from "../llm/context";
import { LlmAbortedError, LlmBudgetExceededError, LlmIncompleteError, LlmNotConfiguredError, LlmPriceRequiredError, LlmProviderError, LlmRefusalError, LlmTruncatedError } from "../llm/errors";
import { NoteSubjectNotFoundError } from "../notes/service";
import { PicksExistError, PicksNotSubmittedError } from "../picks/service";
import { PickNotFoundError } from "../picks/state";
import { EmptySetError } from "../sets/playlist";
import { SetItemNotFoundError, SetNotBuiltError, SetNotFoundError } from "../sets/service";
import { SpotifyApiError, SpotifyBlockedError, SpotifyNotConnectedError } from "../spotify/errors";
import type { Env } from "./context";
import { ApiError } from "./errors";
import { runs, type Run, type RunEvent } from "./runs";

export function toApiError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (error instanceof LlmNotConfiguredError) return new ApiError(503, "llm_not_configured", error.message);
  if (error instanceof LlmPriceRequiredError) return new ApiError(409, "llm_price_required", error.message, { model: error.model });
  if (error instanceof LlmBudgetExceededError)
    return new ApiError(402, "llm_budget_exceeded", error.message, { month: error.month, spentUsd: Math.round(error.spentUsd * 100) / 100, capUsd: error.capUsd });
  if (error instanceof LlmRefusalError) return new ApiError(422, "llm_refused", error.message, { category: error.category });
  if (error instanceof LlmTruncatedError || error instanceof LlmIncompleteError || error instanceof SetNotBuiltError || error instanceof PicksNotSubmittedError || error instanceof PlanNotBuiltError)
    return new ApiError(502, "llm_incomplete", error.message);
  if (error instanceof LlmProviderError) return new ApiError(502, "llm_failed", error.message);
  if (error instanceof SpotifyNotConnectedError) return new ApiError(409, "spotify_not_connected", error.message);
  if (error instanceof SpotifyBlockedError) return new ApiError(503, "spotify_paused", error.message, { reason: error.reason, until: new Date(error.blockedUntil).toISOString() });
  if (error instanceof SpotifyApiError) return new ApiError(502, "spotify_failed", error.message);
  if (error instanceof SetNotFoundError || error instanceof SetItemNotFoundError || error instanceof ThreadNotFoundError || error instanceof PickNotFoundError || error instanceof DigestNotFoundError)
    return new ApiError(404, "not_found", "Not found");
  if (error instanceof PlanNotFoundError || error instanceof StandingNotFoundError) return new ApiError(404, "not_found", "Not found");
  if (error instanceof NoteSubjectNotFoundError) return new ApiError(404, "not_found", error.message);
  if (error instanceof PicksExistError) return new ApiError(409, "picks_exist", error.message, { week: error.week });
  if (error instanceof EmptySetError) return new ApiError(409, "set_empty", error.message);
  if (error instanceof RecapPeriodError) return new ApiError(409, "period_unavailable", error.message);
  if (error instanceof EmptyRecapPlaylistError) return new ApiError(409, "playlist_empty", error.message);
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
  return c.var.deps.services.assistant;
}

const wantsStream = (c: Context) => c.req.header("accept")?.includes("text/event-stream") ?? false;

const errorBody = (error: unknown) => {
  const api = toApiError(error);
  if (!(api instanceof ApiError)) console.error(error);
  return { error: api instanceof ApiError ? { code: api.code, message: api.message, ...(api.details ? { details: api.details } : {}) } : { code: "internal", message: "Internal server error" } };
};

/** Streams a run as SSE: a `run` event with its id, everything it has emitted so far, then what follows. Closing the stream leaves the run working. */
export function followRun(c: Context<Env>, run: Run, keepAliveMs = 5_000) {
  return streamSSE(c, async (stream) => {
    let chain = Promise.resolve();
    const write = (event: string, data: unknown) => {
      chain = chain.then(() => stream.writeSSE({ event, data: JSON.stringify(data) })).catch(() => {});
    };
    write("run", { id: run.id, startedAt: new Date(run.startedAt).toISOString() });
    // Bun closes a response that sends nothing for 10 s, and a tool call can take longer, so a comment line keeps the stream open.
    const keepAlive = setInterval(() => {
      chain = chain.then(async () => void (await stream.write(": keep-alive\n\n"))).catch(() => {});
    }, keepAliveMs);
    await new Promise<void>((resolve) => {
      const unfollow = run.follow((e) => {
        write(e.event, e.data);
        if (e.event === "done" || e.event === "error") resolve();
      });
      stream.onAbort(() => {
        unfollow();
        resolve();
      });
      if (run.finishedAt !== null) resolve();
    });
    clearInterval(keepAlive);
    await chain;
  });
}

function runEvent(e: AgentEvent): RunEvent {
  if (e.type === "text") return { event: "text", data: { delta: e.delta } };
  if (e.type === "visual") return { event: "visual", data: { id: e.id, visual: e.visual } };
  return { event: "tool", data: { name: e.name, input: e.input } };
}

/**
 * JSON by default. With `Accept: text/event-stream` the work becomes a run that continues when the client
 * disconnects: `text`, `tool` and `visual` events while Claude works, then one `done` event with the same body the JSON
 * response would have, or one `error` event. Only `DELETE /api/runs/:id` stops it.
 */
export async function respond<T>(c: Context<Env>, work: (ctx: FeatureContext, onEvent?: (e: AgentEvent) => void) => Promise<T>, status: 200 | 201 = 200, keepAliveMs = 5_000) {
  const base = featureContext(c);
  if (!wantsStream(c)) return c.json((await mapped(() => work(base))) as object, status);
  await mapped(() => c.var.deps.services.llm.assertAvailable());
  const now = c.var.deps.now;
  const run = runs.start(c.req.path, now());
  void work({ ...base, llm: base.llm.withSignal(run.signal) }, (e) => run.emit(runEvent(e), now())).then(
    (result) => run.emit({ event: "done", data: result }, now()),
    (error) => {
      if (!(error instanceof LlmAbortedError)) run.emit({ event: "error", data: errorBody(error) }, now());
    },
  );
  return followRun(c, run, keepAliveMs);
}
