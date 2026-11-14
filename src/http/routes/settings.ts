import { Hono } from "hono";
import { z } from "zod";
import { canRegisterCommands, registerCommands } from "../../discord";
import { DiscordApiError } from "../../discord/rest";
import { LlmKeyRejectedError } from "../../llm/client";
import { applySettings } from "../../settings/apply";
import { settingsView } from "../../settings/view";
import type { Env } from "../context";
import { ApiError, jsonBody, parse } from "../errors";

const patchBody = z.record(z.string(), z.unknown());
const verifyBody = z.object({ apiKey: z.string().min(1).optional() });

export const settingsRoutes = new Hono<Env>()
  .get("/", (c) => c.json(settingsView(c.var.deps.settings)))
  .patch("/", async (c) => {
    const result = await applySettings(c.var.deps, parse(patchBody, await jsonBody(c)));
    return c.json({ ...settingsView(c.var.deps.settings), ...result });
  })
  .post("/claude/verify", async (c) => {
    const { settings, services } = c.var.deps;
    const body = parse(verifyBody, await jsonBody(c));
    const { apiKey: current, model } = settings.get().llm;
    const apiKey = body.apiKey ?? current;
    if (!apiKey) throw new ApiError(409, "llm_not_configured", "No Claude API key to verify");
    try {
      await services.llmKeyCheck(apiKey, model);
      return c.json({ valid: true, model });
    } catch (error) {
      if (error instanceof LlmKeyRejectedError) return c.json({ valid: false, model, message: error.message });
      throw new ApiError(502, "llm_failed", "Could not reach the Claude API");
    }
  })
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
