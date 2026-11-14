import { loadConfig } from "../config";
import { openDb } from "../db/client";
import { createServices } from "../services";
import { SettingsStore } from "../settings/store";
import { SpotifyAuth } from "../spotify/auth";
import { SpotifyClient } from "../spotify/client";
import { createDiscord, registerCommands } from "./index";

const config = loadConfig();
const db = openDb(config.databasePath);
const settings = new SettingsStore(db, config);
const discordConfig = settings.get().discord;
if (!discordConfig) throw new Error("Set the Discord application id, public key and owner id (in Settings or DISCORD_* env vars)");
const spotify = new SpotifyClient(db, new SpotifyAuth(db, config, settings), settings);
const discord = createDiscord(discordConfig, { db, config, settings, services: createServices(db, config, settings, spotify), now: Date.now });
const registered = await registerCommands(discord);
console.log(`Registered ${registered.length} guild commands: ${registered.map((c) => `/${c.name}`).join(" ")}`);
