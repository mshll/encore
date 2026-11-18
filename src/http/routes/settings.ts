import { Hono, type Context } from "hono";
import { z } from "zod";
import { canRegisterCommands, registerCommands } from "../../discord";
import { DiscordApiError } from "../../discord/rest";
import { LlmProviderError } from "../../llm/errors";
import { DEFAULT_MODELS, hasWebSearch } from "../../llm/providers";
import { AI_PROVIDERS } from "../../llm/types";
import { aiReady, type AiConfig } from "../../settings/settings";
import { toApiError } from "../assistant";
import { applyHistoryStart, backupDirFor, playsBefore, SnapshotError } from "../../plays/historyStart";
import { applySettings } from "../../settings/apply";
import { settingsView } from "../../settings/view";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";

const patchBody = z.record(z.string(), z.unknown());
const verifyBody = z.object({
  provider: z.enum(AI_PROVIDERS).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.url({ protocol: /^https?$/ }).optional(),
});

function keyProblem(error: LlmProviderError, model: string): string | null {
  if (error.status === 401 || error.status === 403) return "The API key was rejected";
  if (error.status === 404) return `Model ${model} is not available to this key`;
  if (error.status === 400 || error.status === 422) return `The provider refused the request; check the model name (${model})`;
  return null;
}

/** One minimal call through src/llm with the saved settings, or the unsaved values in the body over them. */
async function verifyAi(c: Context<Env>) {
  const { settings, services } = c.var.deps;
  const body = parse(verifyBody, await jsonBody(c));
  const saved = settings.get().llm.ai;
  const provider = body.provider ?? saved.provider;
  const same = provider === saved.provider;
  const ai: AiConfig = {
    ...saved,
    provider,
    model: body.model ?? (same ? saved.model : DEFAULT_MODELS[provider]),
    apiKey: body.apiKey ?? (same ? saved.apiKey : undefined),
    baseUrl: provider === "openai-compatible" ? (body.baseUrl ?? saved.baseUrl) : undefined,
    webSearch: hasWebSearch(provider),
  };
  if (!aiReady(ai)) throw new ApiError(409, "llm_not_configured", "Choose a model and add an API key (or a base URL) first");
  const model = ai.model!;
  try {
    const answered = await services.llm.verify(ai);
    return c.json({ valid: true, provider, model: answered });
  } catch (error) {
    if (error instanceof LlmProviderError) {
      const message = keyProblem(error, model);
      if (message) return c.json({ valid: false, provider, model, message });
      throw new ApiError(502, "llm_failed", "Could not reach the provider");
    }
    throw toApiError(error);
  }
}
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a date as YYYY-MM-DD");
const historyQuery = z.object({ before: day });
const historyBody = z.object({ historyStart: day });

export const settingsRoutes = new Hono<Env>()
  .get("/", (c) => c.json(settingsView(c.var.deps.settings)))
  .patch("/", async (c) => {
    const result = await applySettings(c.var.deps, parse(patchBody, await jsonBody(c)));
    return c.json({ ...settingsView(c.var.deps.settings), ...result });
  })
  .post("/adopt-env", (c) => {
    const result = c.var.deps.settings.adoptEnv();
    return c.json({ ...settingsView(c.var.deps.settings), ...result });
  })
  .get("/history-start", (c) => c.json(playsBefore(c.var.deps.db, parse(historyQuery, c.req.query()).before)))
  .post("/history-start", async (c) => {
    const { db, settings, config, now } = c.var.deps;
    const { historyStart } = parse(historyBody, await jsonBody(c));
    try {
      const { removed, snapshot } = applyHistoryStart({ db, settings, backupDir: backupDirFor(config.databasePath), now }, historyStart);
      return c.json({ ...settingsView(settings), removed, snapshot });
    } catch (error) {
      if (error instanceof SnapshotError) throw new ApiError(500, "snapshot_failed", "Could not write a snapshot of the database, so nothing was deleted");
      throw error;
    }
  })
  .post("/ai/verify", verifyAi)
  .post("/claude/verify", verifyAi)
  .post("/discord/register", async (c) => {
    const discord = c.var.deps.discord.current();
    if (!discord) throw new ApiError(409, "discord_not_configured", "Set the Discord application id, public key and owner id first");
    if (!canRegisterCommands(discord)) throw new ApiError(409, "discord_registration_unavailable", "Set the Discord bot token and guild id first");
    try {
      const commands = await registerCommands(discord);
      return c.json({ registered: commands.length, commands: commands.map((command) => command.name) });
    } catch (error) {
      if (error instanceof DiscordApiError) throw new ApiError(502, "discord_failed", error.message);
      throw error;
    }
  });
