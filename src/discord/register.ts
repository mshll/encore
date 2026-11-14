import { loadConfig } from "../config";
import { openDb } from "../db/client";
import { createServices } from "../services";
import { SpotifyAuth } from "../spotify/auth";
import { SpotifyClient } from "../spotify/client";
import { createDiscord, registerCommands } from "./index";

const config = loadConfig();
if (!config.discord) throw new Error("Set DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY and DISCORD_OWNER_ID");
const db = openDb(config.databasePath);
const spotify = new SpotifyClient(db, new SpotifyAuth(db, config), config);
const discord = createDiscord(config.discord, { db, config, services: createServices(db, config, spotify), now: Date.now });
const registered = await registerCommands(discord);
console.log(`Registered ${registered.length} guild commands: ${registered.map((c) => `/${c.name}`).join(" ")}`);
