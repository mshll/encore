import { canRegisterCommands, registerCommands, type DiscordSource } from "../discord";
import type { SettingsStore } from "./store";

export type SettingsEffect =
  | { type: "spotify_disconnected" }
  | { type: "timezone_forward_only" }
  | { type: "discord_commands_registered"; count: number }
  | { type: "discord_registration_failed"; message: string };

export type ApplyDeps = {
  settings: SettingsStore;
  spotifyAuth: { status(): { connected: boolean } };
  discord: DiscordSource;
};

const REGISTRATION_KEYS = ["discordApplicationId", "discordBotToken", "discordGuildId"];

/** Saves a settings patch (all or nothing) and carries out what the change needs beyond the store. */
export async function applySettings(deps: ApplyDeps, patch: Record<string, unknown>): Promise<{ changed: string[]; effects: SettingsEffect[] }> {
  const wasConnected = deps.spotifyAuth.status().connected;
  const changed = deps.settings.update(patch);
  const effects: SettingsEffect[] = [];
  if (wasConnected && !deps.spotifyAuth.status().connected) effects.push({ type: "spotify_disconnected" });
  if (changed.includes("timezone")) effects.push({ type: "timezone_forward_only" });
  const discord = deps.discord.current();
  if (discord && canRegisterCommands(discord) && changed.some((key) => REGISTRATION_KEYS.includes(key))) {
    try {
      effects.push({ type: "discord_commands_registered", count: (await registerCommands(discord)).length });
    } catch (error) {
      effects.push({ type: "discord_registration_failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { changed, effects };
}
