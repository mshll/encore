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

First login: register a passkey with `SETUP_TOKEN` (`POST /api/auth/register/options` and `/verify`, see the API doc). After that, only a signed-in session can add passkeys.

Checks: `bun test`, `bun run typecheck`.

## Environment

All config is env vars, validated at boot (the process exits on invalid values). See [.env.example](.env.example).

| Var | Default | Notes |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | required | PKCE client, no secret |
| `PUBLIC_BASE_URL` | `http://localhost:8888` | Browser origin. Sets passkey RP ID, cookie `Secure` (https), and post-OAuth redirect |
| `SPOTIFY_REDIRECT_URI` | `PUBLIC_BASE_URL/callback` | Must be registered in the Spotify app |
| `SETUP_TOKEN` | unset | Min 24 chars. Needed to register the first passkey |
| `ADMIN_TOKEN` | unset | Min 24 chars. Bearer token for `/api/tags/*` only |
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
src/ingest/live/         recently-played poller, track and artist enrichment, album art
src/spotify/             OAuth (PKCE, rotating refresh), API client, rate-limit gate
src/auth/                passkeys, sessions
src/tags/                tag vocabulary, validation, storage
src/analytics/           pure query functions
src/jobs/                scheduler and persisted job state
src/http/                Hono app and routes
web/                     reserved for the UI (Vite + React), built into web/dist
```
