import { Passkeys } from "./auth/passkeys";
import { loadConfig } from "./config";
import { openDb } from "./db/client";
import { createApp } from "./http/app";
import { createJobs } from "./jobs/definitions";
import { startScheduler } from "./jobs/scheduler";
import { SpotifyAuth } from "./spotify/auth";
import { SpotifyClient } from "./spotify/client";

const config = loadConfig();
const db = openDb(config.databasePath);
const spotifyAuth = new SpotifyAuth(db, config);
const spotify = new SpotifyClient(db, spotifyAuth, config);
const jobs = createJobs(db, config, spotifyAuth, spotify);
const app = createApp({ db, config, passkeys: new Passkeys(db, config), spotifyAuth, spotify, jobs, now: Date.now });

const server = Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch, maxRequestBodySize: 512 * 1024 * 1024 });
const stopJobs = config.jobsEnabled ? startScheduler(db, [jobs.poll, jobs.enrich, jobs.art]) : () => {};
console.log(`encore listening on http://${server.hostname}:${server.port} (public ${config.publicBaseUrl})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopJobs();
    server.stop();
    process.exit(0);
  });
}
