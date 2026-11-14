import { Passkeys } from "./auth/passkeys";
import { loadConfig } from "./config";
import { openDb } from "./db/client";
import { canRegisterCommands, DiscordHost, registerCommands } from "./discord";
import { publishAssistantPosts } from "./discord/posts";
import { createApp } from "./http/app";
import { IMPORT_BODY_BYTES } from "./http/bodyLimits";
import { createAssistantJobs } from "./jobs/assistant";
import { createJobs, enabledJobs } from "./jobs/definitions";
import { startScheduler } from "./jobs/scheduler";
import { createServices } from "./services";
import { SettingsStore } from "./settings/store";
import { SpotifyAuth } from "./spotify/auth";
import { SpotifyClient } from "./spotify/client";

const config = loadConfig();
const db = openDb(config.databasePath);
const settings = new SettingsStore(db, config);
const spotifyAuth = new SpotifyAuth(db, config, settings);
const spotify = new SpotifyClient(db, spotifyAuth, settings);
const services = createServices(db, config, settings, spotify);
const jobs = createJobs(db, settings, spotifyAuth, spotify, services);
const discordCtx = { db, config, settings, services, now: Date.now };
const discord = new DiscordHost(settings, discordCtx);
const publish = async () => {
  const current = discord.current();
  return current?.config.botToken && current.config.channelId ? publishAssistantPosts(current, discordCtx) : undefined;
};
const assistantJobs = createAssistantJobs(services.assistant, spotifyAuth, publish);
const app = createApp({ db, config, settings, passkeys: new Passkeys(db, config), spotifyAuth, spotify, jobs, services, discord, now: Date.now });

const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch, maxRequestBodySize: IMPORT_BODY_BYTES });
const scheduler = config.jobsEnabled ? startScheduler(db, [...enabledJobs(jobs, config), assistantJobs.picks, assistantJobs.digest, assistantJobs.outcomes]) : null;
settings.subscribe(() => scheduler?.reschedule());
console.log(`encore listening on http://${server.hostname}:${server.port} (public ${config.publicBaseUrl})`);
const startupDiscord = discord.current();
if (startupDiscord && canRegisterCommands(startupDiscord)) {
  registerCommands(startupDiscord).then(
    (commands) => console.log(`Discord: ${commands.length} guild commands registered`),
    (error: unknown) => console.error(`Discord command registration failed: ${error instanceof Error ? error.message : error}`),
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    scheduler?.stop();
    server.stop();
    process.exit(0);
  });
}
