# Configuration

Two kinds of configuration:

- Boot config is env only, read once at start: `HOST`, `PORT`, `DATABASE_PATH`, `WEB_DIST`, `PUBLIC_BASE_URL`, `REDIRECT_HOSTS`, `SPOTIFY_REDIRECT_URI`, `SETUP_TOKEN`, `SECRETS_KEY`, `JOBS_ENABLED`, `JOBS_DISABLED`, `LLM_PRICES`.
- Every other variable below is a setting. Settings live in the `settings` table and are edited in the dashboard (`GET`/`PATCH /api/settings`); services read them on each use, so a change applies without a restart. An env var of the same name, when set, overrides the stored value and locks the field in the dashboard. With no env var and nothing stored, the default applies.

To move settings from env vars to the dashboard, use Save them here in Settings (`POST /api/settings/adopt-env`): it stores the current env values without changing them. Then remove those env vars and restart; the stored values apply from then on.

Secrets set from the dashboard (AI provider key, Discord bot token, MCP token, admin token, S3 keys, ntfy topic and token, Discord webhook) are encrypted with `SECRETS_KEY` before they are stored. Without `SECRETS_KEY` they can only come from env vars. Changing `SECRETS_KEY` makes stored secrets unreadable; save them again.

All env values are validated at boot (the process exits on invalid values). See [.env.example](../.env.example).

| Var | Default | Notes |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `http://localhost:8888` | Browser origin. Sets passkey RP ID, cookie `Secure` (https), and post-OAuth redirect |
| `REDIRECT_HOSTS` | unset | Comma-separated old host names. GET and HEAD requests to them answer 301 to the same path on `PUBLIC_BASE_URL`; other methods are served there, so webhooks and MCP clients with the MCP token keep working. MCP OAuth works only on `PUBLIC_BASE_URL`: a connector added with an old address must be added again with the public one. Passkeys belong to one host: after a move, add a new passkey on the new one |
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
| `HISTORY_START` | unset | Local day `YYYY-MM-DD`, not in the future. Plays before it are never stored. Plays already stored are deleted only from Settings (`POST /api/settings/history-start`), after a snapshot to `backups/` next to the database |
| `JOBS_ENABLED` | `true` | Poller and enrichment |
| `POLL_INTERVAL_SECONDS` | `300` | Min 60 |
| `ENRICH_INTERVAL_SECONDS`, `ENRICH_BATCH_SIZE` | `120`, `1` | Seconds between enrichment runs, Web API calls per run (track or artist, most listened first) |
| `ART_INTERVAL_SECONDS` | `4` | Seconds between album-art lookups through Spotify's public oEmbed endpoint |
| `SPOTIFY_MIN_INTERVAL_MS` | `2000` | Minimum spacing between Spotify Web API calls. All calls share one queue; calls made for a request go before calls made by jobs |
| `QUOTA_BACKOFF_HOURS` | `12` | Pause after a Spotify `QUOTA_EXCEEDED` 429 |
| `JOBS_DISABLED` | empty | Comma-separated job names to skip: `poll`, `enrich`, `art`, `watch`, `radar`, `library`, `living`, `backup`, `alerts` |
| `WATCHER_ACTIVE_SECONDS`, `WATCHER_IDLE_SECONDS`, `WATCHER_BACKOFF_MAX_SECONDS` | `15`, `60`, `900` | Player watcher cadence while playing, while idle, and the longest back-off after a 429 |
| `DJ_SKIP_TRIGGER` | `2` | Consecutive skips in a DJ session that trigger a re-plan |
| `DJ_REPLANNER`, `DJ_REPLAN_TIMEOUT_SECONDS` | `deterministic`, `20` | `llm` re-plans with the AI provider; any error, refusal, spent budget or timeout falls back to the deterministic plan |
| `RADAR_MIN_LISTENS`, `RADAR_INTERVAL_MINUTES`, `RADAR_ARTISTS_PER_RUN`, `RADAR_RECHECK_DAYS`, `RADAR_BASELINE_DAYS` | `20`, `60`, `2`, `7`, `30` | Release radar: which artists, how often it runs, Web API calls per run, days between checks of one artist, look-back on an artist's first check |
| `LIBRARY_SYNC_HOURS`, `LIBRARY_PAGE_SECONDS` | `24`, `20` | Saved songs and own playlists: hours between full passes, seconds between page calls |
| `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_OWNER_ID` | unset | Enable `POST /api/discord/interactions`. Only `DISCORD_OWNER_ID` may use commands |
| `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | unset | Guild command registration (at startup, or `bun run discord:register`) |
| `DISCORD_CHANNEL_ID` | unset | With `DISCORD_BOT_TOKEN`: channel for weekly picks, the weekly digest (with new releases) and the monthly recap, each posted once |
| `MCP_TOKEN` | unset | Min 24 chars. Bearer token for `/mcp`, for clients that can send a header (Claude Code, scripts) |
| `MCP_OAUTH` | `false` | OAuth sign-in for `/mcp`, for claude.ai custom connectors and other clients that cannot send a fixed token. `/mcp` is on when `MCP_TOKEN` is set or this is `true`; either way the other keeps working |
| `AI_PROVIDER` | `anthropic` | `anthropic`, `openai`, `google` or `openai-compatible` (OpenRouter, Groq, Mistral, Ollama, LM Studio and other servers with an OpenAI-style chat API). Without a usable provider the AI features return `503 llm_not_configured` and the rest of encore works as before |
| `AI_MODEL` | per provider | Any model id the provider serves. Defaults: `claude-opus-5-5`, `gpt-6.2-sol`, `gemini-4-carbon`; an OpenAI-compatible server has no default and needs one |
| `AI_API_KEY` | unset | Secret. The provider's API key. Optional for an OpenAI-compatible server that needs none (a local Ollama or LM Studio) |
| `AI_BASE_URL` | unset | OpenAI-compatible only: the server's API address, for example `http://localhost:11434/v1` |
| `AI_INPUT_PRICE`, `AI_OUTPUT_PRICE` | unset | USD per million input and output tokens, for a model encore has no price for. Both are needed. Without them an unknown model is charged at its provider's highest known rate, and an OpenAI-compatible model counts as free (its tokens are still recorded) |
| `ANTHROPIC_API_KEY`, `LLM_MODEL` | unset | Earlier names, still read: with `AI_PROVIDER` at `anthropic` and `AI_API_KEY` or `AI_MODEL` unset, they give the key and the model |
| `LLM_PRICES` | built in | Boot config. JSON overrides over the built-in price table, USD per million tokens, keyed by model: `input`, `output`, and optional `cacheRead` and `cacheWrite` (the older `cacheWrite5m` is read as `cacheWrite`) |
| `MONTHLY_BUDGET_USD` | `100` | AI spend cap per local month, checked before every call. At the cap, AI endpoints return `402` and AI jobs skip |
| `DEFAULT_MAX_PER_ARTIST`, `DEFAULT_MAX_PER_ALBUM`, `DEFAULT_NEW_SONGS` | unset | Default constraints (unset: no limit). A new set copies them, field by field, unless its request gives a value. Caps are 1-80; `DEFAULT_NEW_SONGS` is 0-80, the exact number of songs the owner has never played. DJ sessions not started from a set use the artist and album caps; weekly picks use the album cap |
| `PICKS_PER_WEEK`, `PICKS_FAR_OUT` | `5`, `1` | Weekly picks, and how many of them are far from the owner's taste |
| `PICKS_WEEKDAY`, `PICKS_HOUR` | `5`, `10` | When weekly picks run (ISO weekday, local hour) |
| `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP` | `24`, `14` | Hours between scheduled backups (min 1) to `backups/` next to the database, and how many to keep (1 to 1000), here and in the bucket |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION` | unset | S3-compatible bucket for a copy of each backup. Region is optional (`auto` for Cloudflare R2) |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | unset | Secrets. With the endpoint and bucket, turn the bucket copy on |
| `ALERT_NTFY_URL`, `ALERT_NTFY_TOPIC`, `ALERT_NTFY_TOKEN` | `https://ntfy.sh`, unset, unset | ntfy server, topic (secret: on a public server it is the only access control) and optional access token (secret). Alerts go to ntfy when the topic is set |
| `ALERT_DISCORD_WEBHOOK_URL` | unset | Secret. A Discord webhook for alerts |
| `ALERT_DISCORD_CHANNEL` | `false` | Also post alerts to `DISCORD_CHANNEL_ID` with the bot |
| `ALERT_POLL_STALE_HOURS` | `2` | Alert when recently played has not been checked for this long while Spotify is connected (0.25 to 168) |
| `DIGEST_WEEKDAY`, `DIGEST_HOUR` | `5`, `9` | Weekly digest slot; the monthly recap runs on the 1st at `DIGEST_HOUR` |

Weekend days are a setting (`WEEKEND_DAYS`, default Friday and Saturday). Unlike the timezone, a change applies to all stored plays at once: the weekday is stored, the weekend is decided at query time.

Web search: weekly picks and liner notes use the provider's own web search when it has one (Anthropic, OpenAI, Google). An OpenAI-compatible server has none: picks are then chosen without sources (no source link under the reason), and notes are written from what the model knows. `GET /api/status` reports this as `ai.webSearch`.
