import { Passkeys } from "./auth/passkeys";
import { loadConfig } from "./config";
import { openDb } from "./db/client";
import { createDiscord, registerCommands } from "./discord";
import { createApp } from "./http/app";
import { createAssistantJobs } from "./jobs/assistant";
import { createJobs, enabledJobs } from "./jobs/definitions";
import { startScheduler } from "./jobs/scheduler";
import { createServices } from "./services";
import { SpotifyAuth } from "./spotify/auth";
import { SpotifyClient } from "./spotify/client";

const config = loadConfig();
const db = openDb(config.databasePath);
const spotifyAuth = new SpotifyAuth(db, config);
const spotify = new SpotifyClient(db, spotifyAuth, config);
const services = createServices(db, config, spotify);
const jobs = createJobs(db, config, spotifyAuth, spotify, services);
const assistantJobs = createAssistantJobs(services.assistant, spotifyAuth);
const discord = config.discord ? createDiscord(config.discord, { db, config, services, now: Date.now }) : null;
const app = createApp({ db, config, passkeys: new Passkeys(db, config), spotifyAuth, spotify, jobs, services, discord, now: Date.now });

const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch, maxRequestBodySize: 512 * 1024 * 1024 });
const stopJobs = config.jobsEnabled ? startScheduler(db, [...enabledJobs(jobs, config), assistantJobs.picks, assistantJobs.digest, assistantJobs.outcomes]) : () => {};
console.log(`encore listening on http://${server.hostname}:${server.port} (public ${config.publicBaseUrl})`);
if (discord?.config.botToken && discord.config.guildId) {
  registerCommands(discord).then(
    (commands) => console.log(`Discord: ${commands.length} guild commands registered`),
    (error: unknown) => console.error(`Discord command registration failed: ${error instanceof Error ? error.message : error}`),
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopJobs();
    server.stop();
    process.exit(0);
  });
}
