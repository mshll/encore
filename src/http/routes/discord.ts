import { Hono } from "hono";
import { verifyDiscordSignature } from "../../discord/verify";
import type { Interaction } from "../../discord/types";
import type { Env } from "../context";
import { ApiError } from "../errors";

export const discordRoutes = new Hono<Env>().post("/interactions", async (c) => {
  const discord = c.var.deps.discord.current();
  if (!discord) throw new ApiError(404, "not_found", "Discord is not configured");
  const body = await c.req.text();
  const valid = await verifyDiscordSignature(discord.config.publicKey, c.req.header("x-signature-ed25519"), c.req.header("x-signature-timestamp"), body, c.var.deps.now());
  if (!valid) throw new ApiError(401, "invalid_signature", "Invalid request signature");
  let interaction: Interaction;
  try {
    interaction = JSON.parse(body) as Interaction;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be JSON");
  }
  return c.json(await discord.interactions.handle(interaction));
});
