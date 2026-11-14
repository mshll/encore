import type { DiscordConfig } from "../config";
import { registerAssistantCommands } from "./commands/assistant";
import { registerCoreCommands } from "./commands/core";
import { InteractionHandler } from "./interactions";
import { DiscordRegistry, type DiscordContext } from "./registry";
import { DiscordRest } from "./rest";

export type Discord = { config: DiscordConfig; registry: DiscordRegistry; rest: DiscordRest; interactions: InteractionHandler };

export function createDiscord(config: DiscordConfig, ctx: DiscordContext, fetchFn: typeof fetch = fetch): Discord {
  const registry = registerAssistantCommands(registerCoreCommands(new DiscordRegistry()));
  const rest = new DiscordRest(config.applicationId, config.botToken, fetchFn);
  return { config, registry, rest, interactions: new InteractionHandler(registry, ctx, config, rest) };
}

export async function registerCommands(discord: Discord) {
  if (!discord.config.guildId) throw new Error("DISCORD_GUILD_ID is not set");
  return discord.rest.registerGuildCommands(discord.config.guildId, discord.registry.definitions());
}

export function postToChannel(discord: Discord, message: Parameters<DiscordRest["postMessage"]>[1]) {
  if (!discord.config.channelId) throw new Error("DISCORD_CHANNEL_ID is not set");
  return discord.rest.postMessage(discord.config.channelId, message);
}
