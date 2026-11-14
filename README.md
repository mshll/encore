# encore

Private, single-user Spotify dashboard. Imports the Spotify extended streaming history export, keeps logging new plays from the Spotify API, stores LLM-produced tags per song, and serves analytics as JSON. API contract: [docs/api.md](docs/api.md).

Stack: Bun, TypeScript, Hono, SQLite (bun:sqlite + Drizzle), passkeys via @simplewebauthn/server.

## Run locally

```sh
bun install
cp .env.example .env          # set SETUP_TOKEN and ADMIN_TOKEN (openssl rand -hex 24)
bun run import "/path/to/Spotify Extended Streaming History"
bun run dev                   # http://localhost:8888
```

Open the app on `http://localhost:8888`, not `127.0.0.1`: passkeys need a domain name, and `localhost` is one. Spotify only allows a loopback IP for local redirect URIs, so the OAuth callback goes to `http://127.0.0.1:8888/callback`. The callback does not need the session cookie; it redirects back to `PUBLIC_BASE_URL` when done.

First login: open the app and enter `SETUP_TOKEN` to create a passkey. After that, only a signed-in session can add passkeys.

Checks: `bun test`, `bun run typecheck`, and `cd web && bun run typecheck`.

### Web UI

The UI lives in `web/` (Vite, React, TypeScript, Tailwind, Base UI). For UI work run the API on another port and let Vite own 8888, so the URLs above stay the same:

```sh
PORT=8889 bun run dev                       # API, jobs included
cd web && bun install && bun run dev        # http://localhost:8888, proxies /api and /callback to 8889
```

`cd web && bun run build` writes `web/dist`; `bun run start` then serves it on 8888 with the API. The Docker image builds it the same way.

## Environment

All config is env vars, validated at boot (the process exits on invalid values). See [.env.example](.env.example).

| Var | Default | Notes |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | required | PKCE client, no secret |
| `PUBLIC_BASE_URL` | `http://localhost:8888` | Browser origin. Sets passkey RP ID, cookie `Secure` (https), and post-OAuth redirect |
| `SPOTIFY_REDIRECT_URI` | `PUBLIC_BASE_URL/callback` | Must be registered in the Spotify app |
| `SETUP_TOKEN` | unset | Min 24 chars. Needed to register the first passkey |
| `ADMIN_TOKEN` | unset | Min 24 chars. Bearer token for `/api/tags/*` and `POST /api/import` only |
| `HOST`, `PORT` | `127.0.0.1`, `8888` | Docker image uses `0.0.0.0`, `3000` |
| `DATABASE_PATH` | `./data/encore.db` | Docker image uses `/data/encore.db` |
| `WEB_DIST` | `./web/dist` | Served with SPA fallback when `index.html` exists |
| `TIMEZONE` | `Asia/Kuwait` | IANA zone for day/hour buckets, applied at insert time |
| `HOME_COUNTRY` | `KW` | For trips |
| `JOBS_ENABLED` | `true` | Poller and enrichment |
| `POLL_INTERVAL_SECONDS` | `300` | Min 60 |
| `ENRICH_INTERVAL_SECONDS`, `ENRICH_BATCH_SIZE` | `4`, `1` | Seconds between enrichment runs, Web API calls per run (track or artist, most listened first) |
| `ART_INTERVAL_SECONDS` | `4` | Seconds between album-art lookups through Spotify's public oEmbed endpoint |
| `QUOTA_BACKOFF_HOURS` | `12` | Pause after a Spotify `QUOTA_EXCEEDED` 429 |
| `JOBS_DISABLED` | empty | Comma-separated job names to skip: `poll`, `enrich`, `art`, `watch`, `radar`, `library` |
| `WATCHER_ACTIVE_SECONDS`, `WATCHER_IDLE_SECONDS`, `WATCHER_BACKOFF_MAX_SECONDS` | `15`, `60`, `900` | Player watcher cadence while playing, while idle, and the longest back-off after a 429 |
| `DJ_SKIP_TRIGGER` | `2` | Consecutive skips in a DJ session that trigger a re-plan |
| `RADAR_MIN_LISTENS`, `RADAR_INTERVAL_MINUTES`, `RADAR_ARTISTS_PER_RUN`, `RADAR_RECHECK_DAYS`, `RADAR_BASELINE_DAYS` | `20`, `60`, `2`, `7`, `30` | Release radar: which artists, how often it runs, Web API calls per run, days between checks of one artist, look-back on an artist's first check |
| `LIBRARY_SYNC_HOURS`, `LIBRARY_PAGE_SECONDS` | `24`, `20` | Saved songs and own playlists: hours between full passes, seconds between page calls |
| `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_OWNER_ID` | unset | Enable `POST /api/discord/interactions`. Only `DISCORD_OWNER_ID` may use commands |
| `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID` | unset | Posting to the channel and guild command registration (at startup, or `bun run discord:register`) |
| `MCP_TOKEN` | unset | Min 24 chars. Bearer token for `/mcp`; unset disables it |
| `ANTHROPIC_API_KEY` | unset | Enables the Claude features; without it they return `503 llm_not_configured` |
| `LLM_MODEL` | `claude-opus-5-5` | |
| `LLM_PRICES` | built in | JSON overrides, USD per million tokens, keyed by model |
| `MONTHLY_BUDGET_USD` | `100` | Claude spend cap per local month. At the cap, LLM endpoints return `402` and LLM jobs skip |
| `PICKS_PER_WEEK`, `PICKS_FAR_OUT` | `5`, `1` | Weekly picks, and how many of them are far from the owner's taste |
| `PICKS_WEEKDAY`, `PICKS_HOUR` | `5`, `10` | When weekly picks run (ISO weekday, local hour) |
| `PICKS_PLAYLIST` | `false` | Mirror the week's picks into one private playlist |
| `DIGEST_WEEKDAY`, `DIGEST_HOUR` | `5`, `9` | Weekly digest slot; the monthly recap runs on the 1st at `DIGEST_HOUR` |

## Import

- CLI: `bun run import <dir>` reads every `Streaming_History_Audio_*.json` and `Streaming_History_Video_*.json` in the folder.
- HTTP: `POST /api/import` with the same files as multipart `files`.

Re-importing is safe: rows already stored are skipped. Export rows replace API-logged plays inside the export's time range. `ip_addr` is never stored.

## Deploy (Dokploy)

`docker-compose.yml` builds one image and keeps SQLite in the named volume `encore-data` (mounted at `/data`). It exposes port 3000 without publishing it; point a Dokploy domain at service `encore`, port 3000. Set at least `SPOTIFY_CLIENT_ID`, `SETUP_TOKEN`, and `ADMIN_TOKEN` in Dokploy's environment. `PUBLIC_BASE_URL` defaults to `https://spotify.mshl.me`; register `https://spotify.mshl.me/callback` in the Spotify app.

Local container: `docker compose -f docker-compose.yml -f docker-compose.local.yml up --build` (publishes `127.0.0.1:8888`).

Upload the export with `curl` or the UI after signing in; the CLI also works inside the container: `docker compose exec encore bun run import /path/in/container`.

## Layout

```
src/config.ts            env validation
src/db/                  Drizzle schema, migrations runner (SQL in drizzle/)
src/plays/               shared play model: song key, device enum, local time, inserts
src/ingest/export/       export parsing, import, CLI
src/ingest/live/         recently-played poller, player watcher and its reconciliation, track and artist enrichment, album art
src/player/              typed Spotify playback API
src/dj/                  DJ sessions on an app-owned playlist, pluggable re-planner
src/radar/               release radar
src/library/             saved songs and own playlists sync
src/cleanup/             cleanup proposals; apply and undo (only reachable from the HTTP route)
src/discord/             interactions endpoint logic, REST client, command registry, built-in commands
src/mcp/                 MCP server (tools over analytics and playback)
src/spotify/             OAuth (PKCE, rotating refresh), API client, rate-limit gate
src/auth/                passkeys, sessions
src/tags/                tag vocabulary, validation, storage
src/analytics/           pure query functions
src/llm/                 Claude client wrapper, cost ledger and budget, agent loop, threads
src/library/             song catalog, candidate verification, blocks, play outcomes, library tools
src/taste/               cached taste profile given to Claude
src/sets/ src/picks/     set building and weekly picks
src/ask/ src/notes/      questions over the history, liner notes
src/digest/              weekly and monthly digest facts and text
src/assistant/           plain entry points for chat integrations
src/jobs/                scheduler and persisted job state
src/http/                Hono app and routes
web/                     UI (Vite + React), built into web/dist; dither-kit charts vendored in web/src/components/dither-kit
```
