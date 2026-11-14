# Configuration

Two kinds of configuration:

- Boot config is env only, read once at start: `HOST`, `PORT`, `DATABASE_PATH`, `WEB_DIST`, `PUBLIC_BASE_URL`, `SPOTIFY_REDIRECT_URI`, `SETUP_TOKEN`, `SECRETS_KEY`, `JOBS_ENABLED`, `JOBS_DISABLED`, `LLM_PRICES`.
- Every other variable below is a setting. Settings live in the `settings` table and are edited in the dashboard (`GET`/`PATCH /api/settings`); services read them on each use, so a change applies without a restart. An env var of the same name, when set, overrides the stored value and locks the field in the dashboard. With no env var and nothing stored, the default applies.

To move settings from env vars to the dashboard, use Save them here in Settings (`POST /api/settings/adopt-env`): it stores the current env values without changing them. Then remove those env vars and restart; the stored values apply from then on.

Secrets set from the dashboard (Claude key, Discord bot token, MCP token, admin token) are encrypted with `SECRETS_KEY` before they are stored. Without `SECRETS_KEY` they can only come from env vars. Changing `SECRETS_KEY` makes stored secrets unreadable; save them again.

All env values are validated at boot (the process exits on invalid values). See [.env.example](../.env.example).

| Var | Default | Notes |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://localhost:8888` | Browser origin. Sets passkey RP ID, cookie `Secure` (https), and post-OAuth redirect |
| `SPOTIFY_REDIRECT_URI` | `PUBLIC_BASE_URL/callback` | Must be registered in the Spotify app |
| `SETUP_TOKEN` | unset | Min 24 chars. Needed to register the first passkey |
| `SECRETS_KEY` | unset | Min 32 chars. Encrypts secrets stored from the dashboard |
| `HOST`, `PORT` | `127.0.0.1`, `8888` | Docker image uses `0.0.0.0`, `3000` |
| `DATABASE_PATH` | `./data/encore.db` | Docker image uses `/data/encore.db` |
| `WEB_DIST` | `./web/dist` | Served with SPA fallback when `index.html` exists |
| `SPOTIFY_CLIENT_ID` | unset | Setting. PKCE client, no secret. Changing it disconnects Spotify |
| `ADMIN_TOKEN` | unset | Setting, secret. Min 24 chars. Bearer token for `/api/tags/*` and `POST /api/import` only |
| `TIMEZONE` | `UTC` | IANA zone for day/hour buckets, applied at insert time. Set it before the first import |
| `HOME_COUNTRY` | most-played country | Two-letter code; trips are runs of plays outside it |
| `WEEKEND_DAYS` | `5,6` | ISO weekdays (1 = Monday) that count as the weekend in analytics, picks, sets and DJ plans |
| `JOBS_ENABLED` | `true` | Poller and enrichment |
| `POLL_INTERVAL_SECONDS` | `300` | Min 60 |
| `ENRICH_INTERVAL_SECONDS`, `ENRICH_BATCH_SIZE` | `120`, `1` | Seconds between enrichment runs, Web API calls per run (track or artist, most listened first) |
| `ART_INTERVAL_SECONDS` | `4` | Seconds between album-art lookups through Spotify's public oEmbed endpoint |
| `SPOTIFY_MIN_INTERVAL_MS` | `2000` | Minimum spacing between Spotify Web API calls. All calls share one queue; calls made for a request go before calls made by jobs |
| `QUOTA_BACKOFF_HOURS` | `12` | Pause after a Spotify `QUOTA_EXCEEDED` 429 |
| `JOBS_DISABLED` | empty | Comma-separated job names to skip: `poll`, `enrich`, `art`, `watch`, `radar`, `library` |
| `WATCHER_ACTIVE_SECONDS`, `WATCHER_IDLE_SECONDS`, `WATCHER_BACKOFF_MAX_SECONDS` | `15`, `60`, `900` | Player watcher cadence while playing, while idle, and the longest back-off after a 429 |
| `DJ_SKIP_TRIGGER` | `2` | Consecutive skips in a DJ session that trigger a re-plan |
| `DJ_REPLANNER`, `DJ_REPLAN_TIMEOUT_SECONDS` | `deterministic`, `20` | `llm` re-plans with Claude; any error, refusal, spent budget or timeout falls back to the deterministic plan |
| `RADAR_MIN_LISTENS`, `RADAR_INTERVAL_MINUTES`, `RADAR_ARTISTS_PER_RUN`, `RADAR_RECHECK_DAYS`, `RADAR_BASELINE_DAYS` | `20`, `60`, `2`, `7`, `30` | Release radar: which artists, how often it runs, Web API calls per run, days between checks of one artist, look-back on an artist's first check |
| `LIBRARY_SYNC_HOURS`, `LIBRARY_PAGE_SECONDS` | `24`, `20` | Saved songs and own playlists: hours between full passes, seconds between page calls |
| `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_OWNER_ID` | unset | Enable `POST /api/discord/interactions`. Only `DISCORD_OWNER_ID` may use commands |
| `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | unset | Guild command registration (at startup, or `bun run discord:register`) |
| `DISCORD_CHANNEL_ID` | unset | With `DISCORD_BOT_TOKEN`: channel for weekly picks, the weekly digest (with new releases) and the monthly recap, each posted once |
| `MCP_TOKEN` | unset | Min 24 chars. Bearer token for `/mcp`; unset disables it |
| `ANTHROPIC_API_KEY` | unset | Enables the Claude features; without it they return `503 llm_not_configured` |
| `LLM_MODEL` | `claude-opus-5-5` | |
| `LLM_PRICES` | built in | JSON overrides, USD per million tokens, keyed by model |
| `MONTHLY_BUDGET_USD` | `100` | Claude spend cap per local month. At the cap, LLM endpoints return `402` and LLM jobs skip |
| `PICKS_PER_WEEK`, `PICKS_FAR_OUT` | `5`, `1` | Weekly picks, and how many of them are far from the owner's taste |
| `PICKS_WEEKDAY`, `PICKS_HOUR` | `5`, `10` | When weekly picks run (ISO weekday, local hour) |
| `PICKS_PLAYLIST` | `false` | Mirror the week's picks into one private playlist |
| `DIGEST_WEEKDAY`, `DIGEST_HOUR` | `5`, `9` | Weekly digest slot; the monthly recap runs on the 1st at `DIGEST_HOUR` |

Weekend days are a setting (`WEEKEND_DAYS`, default Friday and Saturday). Unlike the timezone, a change applies to all stored plays at once: the weekday is stored, the weekend is decided at query time.
