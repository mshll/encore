import type { DiscordConfig, SettingsSource } from "../settings/settings";
import { registerAssistantCommands } from "./commands/assistant";
import { registerCoreCommands } from "./commands/core";
import { InteractionHandler } from "./interactions";
import { DiscordRegistry, type DiscordContext } from "./registry";
import { DiscordRest } from "./rest";
import type { MessageFile } from "./types";

export type Discord = { config: DiscordConfig; registry: DiscordRegistry; rest: DiscordRest; interactions: InteractionHandler };

export function createDiscord(config: DiscordConfig, ctx: DiscordContext, fetchFn: typeof fetch = fetch): Discord {
  const registry = registerAssistantCommands(registerCoreCommands(new DiscordRegistry()));
  const rest = new DiscordRest(config.applicationId, config.botToken, fetchFn);
  return { config, registry, rest, interactions: new InteractionHandler(registry, ctx, config, rest) };
}

export interface DiscordSource {
  current(): Discord | null;
}

/** The Discord integration for the current settings, rebuilt when any Discord setting changes. */
export class DiscordHost implements DiscordSource {
  private built: { key: string; discord: Discord } | null = null;

  constructor(
    private readonly settings: SettingsSource,
    private readonly ctx: DiscordContext,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  current(): Discord | null {
    const config = this.settings.get().discord;
    if (!config) {
      this.built = null;
      return null;
    }
    const key = JSON.stringify(config);
    if (this.built?.key !== key) this.built = { key, discord: createDiscord(config, this.ctx, this.fetchFn) };
    return this.built.discord;
  }
}

export const canRegisterCommands = (discord: Discord) => Boolean(discord.config.botToken && discord.config.guildId);

export async function registerCommands(discord: Discord) {
  if (!discord.config.guildId) throw new Error("DISCORD_GUILD_ID is not set");
  return discord.rest.registerGuildCommands(discord.config.guildId, discord.registry.definitions());
}

export function postToChannel(discord: Discord, message: Parameters<DiscordRest["postMessage"]>[1], file?: MessageFile) {
  if (!discord.config.channelId) throw new Error("DISCORD_CHANNEL_ID is not set");
  return file ? discord.rest.postMessageWithFile(discord.config.channelId, message, file) : discord.rest.postMessage(discord.config.channelId, message);
}
