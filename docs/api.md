# encore HTTP API

Contract between the server and the web UI. All routes are JSON over HTTP on the same origin as the UI.

## Conventions

- Base path `/api`. Only exception: `GET /callback` (Spotify OAuth redirect).
- Auth: every `/api/*` route needs a session cookie, except `/api/health`, `/api/auth/*` and `/api/discord/interactions` (Discord signature instead). `/api/tags/*`, `POST /api/import` and `POST /api/import/catalog` also accept `Authorization: Bearer <admin token>`. The admin token is rejected everywhere else. `/mcp` takes only `Authorization: Bearer <MCP token>`. Both tokens are settings (`adminToken`, `mcpToken`; see [Settings](#settings)).
- Session cookie: `__Host-encore_session` when `PUBLIC_BASE_URL` is https, `encore_session` otherwise; `HttpOnly`, `SameSite=Lax`, `Path=/`, 30 days, `Secure` when `PUBLIC_BASE_URL` is https. Send requests with `credentials: "same-origin"` (the default for same-origin `fetch`).
- Writes to `/api/auth/*` are limited to 20 a minute per client address (`429 rate_limited`, with `Retry-After`).
- Every response carries a Content-Security-Policy (scripts and connections from the same origin only, images from any https host) and `X-Frame-Options`; `/api/*` responses carry `Cache-Control: no-store`.
- Errors: non-2xx responses have this body:

  ```json
  { "error": { "code": "invalid_request", "message": "Request validation failed", "details": [{ "path": "from", "message": "expected YYYY-MM-DD" }] } }
  ```

  `details` is present only on some errors. Status codes: `400` validation (`invalid_request`, `invalid_settings`), `401` not signed in, `402` monthly LLM budget spent, `403` setup token wrong or `premium_required`, `404` not found, `409` precondition (`spotify_not_configured`, `spotify_not_connected`, `no_active_device`, `setup_complete`, `llm_not_configured` on key verify, `discord_not_configured`, `discord_registration_unavailable`), `413` file too large, `415` wrong content type, `422` Claude declined, `500` server error (`snapshot_failed`), `502` Spotify, Claude or Discord call failed (`spotify_failed`, `llm_failed`, `discord_failed`), `503` LLM not configured or Spotify calls paused (`spotify_paused`, `details: { reason, until }`). Assistant error codes are listed under [Assistant](#assistant-claude).
- Timestamps (`ts`, `firstPlayed`, `lastPlayed`, `start`, `end`, ...) are ISO 8601 UTC strings.
- Days, hours, weekdays, weeks, months are local time in `TIMEZONE` (default UTC). `day` is `YYYY-MM-DD`. `weekday` is ISO: 1 = Monday ... 7 = Sunday.
- `hours` values are rounded to 2 decimals. Rates (`skipRate`, `shuffleRate`, `share`) are 0..1 rounded to 3 decimals, or `null` when the denominator is 0.

### Common query parameters

| Param | Format | Meaning |
| --- | --- | --- |
| `from`, `to` | `YYYY-MM-DD` | Inclusive local-day range. Both optional (open-ended). `from > to` is a 400. |
| `period` | `day` \| `week` \| `month` \| `year` | Bucket size. Default `month`. `week` labels are the Monday date (`YYYY-MM-DD`), `month` is `YYYY-MM`, `year` is `YYYY`. |
| `limit`, `offset` | integers | Paging. Limits are per endpoint. |

## Assistant runs

A request sent with `Accept: text/event-stream` to `POST /api/sets`, `POST /api/sets/:id/messages`, `POST /api/picks/generate` or `POST /api/ask` starts a run on the server. Closing the stream does not stop it. The stream starts with `event: run` (`{ "id", "startedAt" }`), then `text` and `tool` events, then one `done` or `error`.

- `GET /api/runs?key=<request path>`: `{ "run": { "id", "startedAt" } | null }`, the run still working for that path.
- `GET /api/runs/:id/events`: the same stream again from its first event. Finished runs stay readable for 10 minutes.
- `DELETE /api/runs/:id`: stops the run and its Claude request. `{ "cancelled": true }`.

Runs live in memory: a restart ends them.

## Metric definitions

- **Music play**: a row with `kind = "track"` from the audio export or the API. Podcast episodes, audiobooks, and every row from `Streaming_History_Video_*.json` (music videos included) are stored but excluded from all `/api/stats/*` and `/api/entities/*` numbers. `/api/history` can show them with `kind`.
- **Play**: one row. Includes very short plays.
- **Listen**: a music play with `ms_played >= 30000` (export and live rows) or any API row. The Spotify recently-played API only reports plays it counted, and it does not give `ms_played`.
- **Hours**: sum of `ms_played`. API rows have no `ms_played`, so they count the track's full `duration_ms` once known (from the poll itself or enrichment), else 0.
- **Skip**: Spotify's own `skipped` flag on export rows. Live rows carry the watcher's flag: the track changed before 90% of its duration (see Live plays). API rows have no skip data (`skipped: null`) and are left out of every skip rate denominator, as are live rows whose end the watcher did not see. `skipRate = skips / plays with known skip flag`.
- **Quick skip**: a skip with `ms_played < 5000`.
- **Shuffle rate**: plays with `shuffle = true` / plays with a known shuffle flag.
- **Song (merged track)**: plays are grouped by `songKey`, not URI. `songKey = normalizedTitle + "|" + normalizedArtist`, where normalization lowercases, strips accents, removes `(feat. ...)`, `(with ...)`, `[ft. ...]`, trailing `feat. ...`, and remaster markers (`- Remastered 2011`, `(Remastered)`), then collapses all punctuation to single spaces. Live versions and other edits stay separate. Artist is the export's `master_metadata_album_artist_name` (Spotify's primary artist for the track) or, for API-only tracks, the first listed artist. Song rows show the name, album, and URI of the song's most-played URI.
- **Artist**: grouped by artist name string. **Album**: grouped by (artist, album name).
- **Context dimensions** (used by the skip split and skip profiles). Only rows with a known skip flag (export and live):
  - `hourBucket`: `night` 00-05, `morning` 06-11, `afternoon` 12-17, `evening` 18-23 (local hour).
  - `dayType`: `weekend` on the `weekendDays` setting's ISO weekdays (default 5, 6: Friday and Saturday), else `weekday`. Decided at query time, so a change applies to all stored plays.
  - `shuffle`: `on` / `off`.
  - `device`: the device enum below.
  - `startMode`: `chosen` when `reason_start` is `clickrow`, `playbtn`, or `backbtn` (the owner picked this track); `auto` when it is `trackdone` or `fwdbtn` (the track arrived from the queue). Other start reasons (`appload`, `remote`, `trackerror`, `unknown`) are not a context value.
- **Wrong moment vs dislike** (`GET /api/stats/skips/split`). A skip is not a dislike: a song finished in some contexts and skipped in others was skipped at the wrong moment. For each song with at least `minPlays` (default 8) plays with a known skip flag in the range:
  1. For each context dimension value with at least `minContextPlays` (default 5) of that song's plays, compute that context's skip rate.
  2. A context **works** if its skip rate is `<= 1/3`. A context **fails** if its skip rate is `>= 2/3`.
  3. Classes, checked in this order:
     - `keeper`: overall skip rate `< 0.25`.
     - `wrong_moment`: at least one context works AND at least one context fails.
     - `dislike`: overall skip rate `>= 0.75` AND no context works (skipped nearly everywhere).
     - `mixed`: everything else (skipped often, but no clear context pattern in the data).
  `bestContext` / `worstContext` are the qualifying contexts with the lowest / highest skip rate.
- **Era** (`/api/stats/eras`): top N artists by hours in the range; for each, hours per local month across a continuous month axis, the month with the most hours (`peakMonth`), and first/last play of all time (not limited to the range).
- **Trip**: plays ordered by time, ignoring rows without `conn_country` (all API rows). A trip is a maximal run of consecutive plays whose country is not `HOME_COUNTRY` (unset: the country with the most plays; `homeCountry` is `null` when no play has a country); a single home-country play ends it. A trip can span several countries. Trips with fewer than `minPlays` plays (default 5) are dropped. `days` counts local days from first to last play inclusive. Trip plays count all kinds (country is about location); `hours` and `topTracks` count music only.
- **Forgotten**: songs with at least `minListens` listens (all time) and no play of any kind in the last `days` days.
- **Export vs API and live**: export rows are the source of truth. Importing an export deletes API and live rows from the export's first to last timestamp (plus 999 ms, since export timestamps have second precision), and the poller and the watcher ignore plays at or before the newest export row (+999 ms). `apiPlaysRemoved` counts both.
- **Live plays** (`source: "live"`): the `watch` job polls `GET /me/player` and turns state changes into plays. `ms_played` is the progress it observed (pauses excluded, forward seeks capped at wall time). `skipped` is true when the track changed before 90% of its duration; stopping playback is not a skip. `reason_end` is `trackdone` (reached the last 5 s), `fwdbtn` (changed earlier) or `endplay` (playback stopped); `reason_start` is the previous play's `trackdone`/`fwdbtn`, else `null`. All three are inferred, not Spotify's values. A gap between polls over `2 x WATCHER_IDLE_SECONDS + 30 s` leaves the end unknown (`skipped`, `reason_end` null). `device` comes from the Spotify device name and type; `contextUri` is the playlist or album played from. A watcher that starts mid-track counts the part before its first poll as played.
- **History start** (`historyStart` setting): plays on a local day before it are never stored, whichever path brings them (export import, recently-played poll, watcher). Saving the setting only filters what arrives from then on; plays already stored are removed only by `POST /api/settings/history-start`. Clearing it removes nothing and restores nothing: removed plays return only by importing the export again.
- **One play, two sources**: recently-played reports the same play the watcher saw. An API play matches a live row of the same track when its `played_at` falls between the live row's `ts - ms_played - 15 s` and `ts + 60 s`. The live row wins: the poller skips a matched API play (`skippedCoveredByLive`), and a live row recorded after the API row replaces the nearest matching one.

### Enums

- `device`: `ios`, `android`, `mac`, `windows`, `linux`, `web`, `console`, `tv`, `speaker`, `car`, `unknown`, `other`. Derived from the export `platform` string, or for live rows from the Spotify device name and type (raw value kept server-side). API rows are always `unknown`: recently-played has no device field.
- `kind`: `track`, `episode`, `audiobook`, `video`.
- `source`: `export`, `api`, `live`.

### Shared shapes

`Stats` (used inside many responses):

```json
{ "hours": 47.34, "plays": 810, "listens": 692, "skips": 335, "skipRate": 0.414, "quickSkips": 68,
  "firstPlayed": "2024-12-06T12:19:36.000Z", "lastPlayed": "2026-11-06T17:16:17.000Z" }
```

`Song` = song identity + `Stats`:

```json
{ "songKey": "like you do|joji", "uri": "spotify:track:4vgU9MGJwhgBEtlO8mMN49", "name": "Like You Do", "artist": "Joji",
  "album": "Nectar", "albumArtUrl": "https://i.scdn.co/image/...", "hours": 8.41, "plays": 166, "listens": 121,
  "skips": 64, "skipRate": 0.386, "quickSkips": 40, "firstPlayed": "...", "lastPlayed": "..." }
```

`albumArtUrl` is `null` until art is found. The `art` job fills it from Spotify's public oEmbed endpoint (300 px); track enrichment replaces it with the Web API's largest album image (640 px). A song's art falls back to any version of it that has art.

Artist rows (top artists, eras, skips, search, the artist page, the overview's `topArtist`) carry `imageUrl`: the Spotify image of the artist credited first on the artist's tracks, or `null` until enrichment fetched it.

`SkipProfile`: an object keyed by context dimension; each value is a list sorted by plays, descending.

```json
{ "hourBucket": [{ "value": "evening", "plays": 53, "skips": 10, "skipRate": 0.189 }],
  "dayType": [...], "shuffle": [...], "device": [...], "startMode": [...] }
```

## Health and status

### `GET /api/health` (public)

`{ "ok": true }`

### `GET /api/status`

```json
{
  "timezone": "Europe/London",
  "weekendDays": [5, 6],
  "homeCountry": "GB",
  "spotify": {
    "connected": true,
    "userId": "abc123",
    "scopes": ["user-read-recently-played", "..."],
    "missingScopes": ["user-read-playback-state"],
    "paused": null,
    "pacing": { "minIntervalMs": 2000, "queued": { "interactive": 0, "background": 1 }, "calls": 4210 }
  },
  "poll": { "lastRunAt": "...", "lastSuccessAt": "...", "lastError": null,
            "lastResult": { "received": 50, "inserted": 2, "skippedCoveredByExport": 0 } },
  "enrichment": { "total": 5472, "enriched": 14, "failed": 0, "withArt": 812,
                  "artists": { "total": 310, "fetched": 120, "withImage": 118 },
                  "lastRunAt": "...", "lastSuccessAt": "...", "lastError": null,
                  "lastResult": { "tracks": 1, "artists": 0, "failed": 0 },
                  "art": { "lastRunAt": "...", "lastSuccessAt": "...", "lastError": null,
                           "lastResult": { "attempted": 1, "found": 1, "failed": 0 } } },
  "import": { "lastImportAt": "...", "result": { "...": "ImportResult, see POST /api/import" } },
  "tags": { "songs": 5055, "tagged": 0, "coverage": 0 },
  "plays": { "plays": 39821, "music": 39338, "api": 10, "live": 152 },
  "live": { "watch": { "lastRunAt": "...", "...": "same shape as poll" }, "radar": { "...": "..." }, "library": { "...": "..." }, "living": { "...": "..." } },
  "integrations": { "discord": false, "mcp": true },
  "llm": {
    "configured": true, "model": "claude-opus-5-5", "month": "2026-11",
    "spentUsd": 1.18, "capUsd": 100, "remainingUsd": 98.82, "exhausted": false,
    "byFeature": [{ "feature": "picks", "calls": 6, "usd": 0.64 }],
    "jobs": { "picks": { "lastRunAt": "...", "lastSuccessAt": "...", "lastError": null, "lastResult": { "week": "2026-11-09", "picks": 5 } },
              "digest": { "...": "same shape" }, "outcomes": { "...": "same shape" } },
    "schedule": { "enabled": true, "picks": { "weekday": 5, "hour": 10 }, "digest": { "weekday": 5, "hour": 9 } }
  }
}
```

- `timezone`: the `TIMEZONE` used for every local day, hour and weekday. Format `ts` values in it to match the buckets.
- `weekendDays`: ISO weekdays that count as the weekend (`dayType`). Use it wherever the UI labels weekends.
- `homeCountry`: `HOME_COUNTRY`, or the country with the most plays when unset; `null` when no play has a country.
- `spotify.paused` is `null` or `{ "reason": "rate_limited" | "quota_exceeded", "until": "...", "since": "..." }`. While paused, the server makes no Spotify calls. `quota_exceeded` means the developer-account quota was hit; the pause lasts `QUOTA_BACKOFF_HOURS` (default 12) and the UI should show it.
- `missingScopes`: scopes the server asks for that the stored grant lacks. Reconnect to grant them.
- `spotify.pacing`: every Web API call goes through one queue, one call at a time, at least `SPOTIFY_MIN_INTERVAL_MS` (default 2000) apart. Calls made for a request (HTTP, Discord, MCP) go before calls made by scheduled jobs. `queued` counts calls waiting now; `calls` counts calls since the process started. The oEmbed art lookup is not a Web API call and is not paced.
- `poll.lastResult` also has `skippedCoveredByLive` (API plays the watcher already stored). It may be `{ "skipped": "spotify_not_connected" }`. `lastRunAt`/`lastSuccessAt` are `null` before the first run. `import` is `null` before the first import.
- `enrichment.failed`: tracks given up on after 3 failed lookups. `withArt`: tracks with an `albumArtUrl`.
- Enrichment makes one Web API call per run (`ENRICH_INTERVAL_SECONDS`, default 120): `GET /tracks/{id}` (metadata, 640 px art, artist ids) or `GET /artists/{id}` (image), whichever pending item has more listens. `enrichment.art` is the oEmbed job (`ART_INTERVAL_SECONDS`, default 4). Spotify applies its quota per endpoint, so a `QUOTA_EXCEEDED` answer pauses only that endpoint (listed in `spotify.pausedRoutes`); `spotify.paused` is set only by an ordinary 429, which pauses every call. Enrichment stops while its endpoint is paused; the oEmbed job does not use the Web API and continues.
- `integrations`: whether the Discord endpoint (`DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_OWNER_ID`) and `/mcp` (`MCP_TOKEN`) are configured.
- `enrichment.artists`: artists learned from enriched or polled tracks; `fetched` had their `GET /artists/{id}` lookup.
- `tags`: `songs` known (distinct song keys in `tracks`), `tagged` songs with tags, `coverage` = tagged / songs (0..1, not rounded).
- `plays`: stored rows: all kinds, music only, and rows by source `api` and `live` (the rest are `export`).
- `live`: the `watch`, `radar`, `library` and `living` jobs, same shape as `poll`. `watch.lastResult` is `{ "current": Observation | null, "inserted", "replacedApi", "coveredByExport", "playing" }` for the last tick, or `{ "current", "skipped": "spotify_not_connected" | "spotify_paused", "until"? }`.
- `llm`: Claude spend for the current local month against `MONTHLY_BUDGET_USD`. `exhausted: true` means every LLM endpoint returns `402` and scheduled LLM jobs skip until the next month. `configured: false` means no Claude key (`claudeApiKey` setting or `ANTHROPIC_API_KEY`). `schedule`: when the weekly picks and digest jobs run (ISO weekday 1-7 and local hour, from `PICKS_WEEKDAY`/`PICKS_HOUR` and `DIGEST_WEEKDAY`/`DIGEST_HOUR`); `enabled` is `JOBS_ENABLED`. `byFeature` features: `sets`, `picks`, `ask`, `notes`, `digest`, `dj`. Job `lastResult` may be `{ "skipped": "not_due" | "budget_exceeded" | "llm_not_configured" | "spotify_not_connected" | "attempts_exhausted" }`; the `digest` job runs without Claude too and stores recaps with the numbers alone (`{ "generated": ["monthly:2026-10"] }`). When Discord posting is configured, `picks` and `digest` results also carry `publish: { "posted": ["picks:2026-11-09"] }` or `publish: { "error": "..." }` (see Discord). `outcomes.lastResult` has set and pick outcome refresh counts and, once a day, `library` (pick library state).


## Auth (passkeys)

Use `@simplewebauthn/browser` on the client: pass the options JSON to `startRegistration({ optionsJSON })` / `startAuthentication({ optionsJSON })` and send the result back as `response`. Passkeys are discoverable (no username). The server keeps challenges in memory for 5 minutes; each is single-use.

### `GET /api/auth/session` (public)

`{ "authenticated": false, "setupRequired": true, "setupTokenConfigured": true }`. `setupRequired` is true while no passkey exists. `setupTokenConfigured` is false when `SETUP_TOKEN` is unset: no first passkey can be registered until it is set in env.

### `POST /api/auth/setup/verify` (public)

Body `{ "setupToken": string }`. Lets a first-run wizard check the token before the passkey ceremony. `200 { "valid": true }`; `403 setup_token_invalid`; `409 setup_complete` once a passkey exists. Rate-limited like every write to `/api/auth/*`. The token must still be sent to `register/options` and `register/verify`.

### `POST /api/auth/register/options`

Body `{ "setupToken"?: string }`. Returns WebAuthn `PublicKeyCredentialCreationOptionsJSON`.
- No passkey yet: `setupToken` must equal `SETUP_TOKEN`, else `403 setup_token_invalid`.
- Passkey exists: needs a session (`401` otherwise); `setupToken` is ignored.

### `POST /api/auth/register/verify`

Body `{ "setupToken"?: string, "response": RegistrationResponseJSON }`. Same rules as above. `200 { "registered": true }`. Registering the first passkey also signs you in (sets the cookie). `400 verification_failed` on a bad or replayed response.

### `POST /api/auth/login/options`

No body. Returns `PublicKeyCredentialRequestOptionsJSON`.

### `POST /api/auth/login/verify`

Body `{ "response": AuthenticationResponseJSON }`. `200 { "authenticated": true }` and sets the cookie. `400 passkey_rejected` (unknown passkey) or `400 verification_failed`.

### `POST /api/auth/logout`

`200 { "authenticated": false }`; deletes the session.

## Settings

Runtime configuration, edited from the dashboard. Boot config (`HOST`, `PORT`, `DATABASE_PATH`, `WEB_DIST`, `PUBLIC_BASE_URL`, `SPOTIFY_REDIRECT_URI`, `SETUP_TOKEN`, `SECRETS_KEY`, `JOBS_ENABLED`, `JOBS_DISABLED`, `LLM_PRICES`) stays in env and is not listed here.

- Precedence: an env var of the field's name (`env`), when set, wins and the field is `locked`; else the stored value (`source: "db"`); else the default (`source: "default"`).
- Services read settings on each use. Every change applies without a restart: job intervals re-time waiting jobs at once, schedules (picks, digest) apply at the next hourly check, and a running job uses the new value from its next run.
- Secrets (`secret: true`) are never returned. A field shows `set`, `source` and `hint` (the last 4 characters of a value of 16 or more characters, else `null`). Stored secrets are encrypted with `SECRETS_KEY`. Without it, `secretStorage.available` is false, saving a secret fails with reason `secrets_key_missing`, and env-provided secrets still work. `unreadable: true` marks a stored secret that the current `SECRETS_KEY` cannot open (the key changed); it acts as unset until saved again.

### `GET /api/settings`

```json
{
  "groups": [
    { "id": "locale", "fields": [
      { "key": "timezone", "env": "TIMEZONE", "type": "timezone", "secret": false, "value": "Asia/Kuwait", "default": "UTC",
        "source": "env", "locked": true, "set": true, "hint": null, "unreadable": false, "stored": true, "options": ["Africa/Abidjan", "..."] },
      { "key": "weekendDays", "env": "WEEKEND_DAYS", "type": "weekdays", "secret": false, "value": [5, 6], "default": [5, 6],
        "source": "default", "locked": false, "set": true, "hint": null, "unreadable": false, "stored": false, "min": 1, "max": 7, "unit": "weekday" }
    ] },
    { "id": "claude", "fields": [
      { "key": "claudeApiKey", "env": "ANTHROPIC_API_KEY", "type": "string", "secret": true, "value": null, "default": null,
        "source": "db", "locked": false, "set": true, "hint": "WXYZ", "unreadable": false, "stored": true }
    ] }
  ],
  "secretStorage": { "available": true, "envVar": "SECRETS_KEY" }
}
```

- `type`: `string`, `integer`, `number`, `boolean`, `enum` (pick from `options`), `timezone` (IANA, `options` lists the zones the server accepts), `weekdays` (array of ISO weekdays 1-7, no repeats, returned sorted), `date` (a local day `YYYY-MM-DD` in the configured timezone, not after today there).
- `stored`: the settings table holds a valid value for this field, whatever the `source`. With `source: "env"`, it is the value that applies once the env var is removed and the server restarts.
- `min`/`max` bound numbers (for `weekdays`, each day). `unit`: `ms`, `seconds`, `minutes`, `hours`, `days`, `usd`, `weekday` (ISO 1-7), `hour` (local 0-23).
- `value` is `null` for secrets and for unset optional fields; `set` is false for the latter.

Fields by group (env var in brackets; `*` = secret):

| Group | Fields |
| --- | --- |
| `spotify` | `spotifyClientId` [SPOTIFY_CLIENT_ID] |
| `locale` | `timezone` [TIMEZONE], `homeCountry` [HOME_COUNTRY], `weekendDays` [WEEKEND_DAYS, e.g. `5,6`] |
| `claude` | `claudeApiKey`* [ANTHROPIC_API_KEY], `claudeModel` [LLM_MODEL], `monthlyBudgetUsd` [MONTHLY_BUDGET_USD] |
| `picks` | `picksPerWeek`, `picksFarOut`, `picksWeekday`, `picksHour` [PICKS_*] |
| `digest` | `digestWeekday`, `digestHour` [DIGEST_*] |
| `dj` | `djReplanner`, `djReplanTimeoutSeconds`, `djSkipTrigger` [DJ_*] |
| `discord` | `discordApplicationId`, `discordPublicKey`, `discordOwnerId`, `discordBotToken`*, `discordGuildId`, `discordChannelId` [DISCORD_*] |
| `mcp` | `mcpToken`* [MCP_TOKEN] |
| `access` | `adminToken`* [ADMIN_TOKEN] |
| `history` | `historyStart` [HISTORY_START, e.g. `2024-01-01`] |
| `jobs` | `pollIntervalSeconds`, `enrichIntervalSeconds`, `enrichBatchSize`, `artIntervalSeconds`, `spotifyMinIntervalMs`, `quotaBackoffHours`, `watcherActiveSeconds`, `watcherIdleSeconds`, `watcherBackoffMaxSeconds`, `radarMinListens`, `radarIntervalMinutes`, `radarArtistsPerRun`, `radarRecheckDays`, `radarBaselineDays`, `librarySyncHours`, `libraryPageSeconds` |

Defaults and bounds match the table in [configuration.md](configuration.md).

### `PATCH /api/settings`

Body: an object of field key to value, e.g. `{ "timezone": "Europe/London", "picksHour": 8, "claudeApiKey": "sk-ant-..." }`. `null` or `""` clears the stored value (the default applies again). The patch is checked as a whole: one bad field and nothing is saved.

`200`: the `GET` shape plus `changed` (keys whose effective value changed) and `effects`:

| Effect | When |
| --- | --- |
| `{ "type": "spotify_disconnected" }` | The Spotify client id changed while connected. The grant belongs to the old app; connect again. Switching back to the old id restores it. |
| `{ "type": "timezone_forward_only" }` | The timezone changed. Local day, hour and weekday are stored with each play at insert time, so only plays stored from now on use the new zone. Set it before the first import. |
| `{ "type": "discord_commands_registered", "count": 9 }` | The Discord application id, bot token or guild id changed and the bot token and guild id are set: guild commands were registered again. |
| `{ "type": "discord_registration_failed", "message": "..." }` | Same, but Discord refused. The settings are saved; fix them or retry with `POST /api/settings/discord/register`. |

`400 invalid_settings` with `details: [{ "key", "reason", "message" }]`, `reason` one of `invalid`, `unknown`, `locked` (set by env; change it there), `secrets_key_missing`.

No setting needs a restart.

### `POST /api/settings/adopt-env`

No body. Copies the current value of every env-provided field into the settings table (secrets encrypted with `SECRETS_KEY`), so the owner can then remove the env vars without a gap. Env keeps precedence: no effective value changes, every field keeps `source: "env"` and `locked: true`, and no effect runs (no Spotify disconnect, no Discord registration, no reschedule). After an env var is removed and the server restarts, the field reads `source: "db"` with the same value. Running it again writes nothing.

`200`: the `GET` shape plus:

- `adopted`: keys written by this call. A key whose stored value already matches env is not written and not listed.
- `replaced`: keys in `adopted` whose stored value differed from env and was overwritten.
- `skipped`: `[{ "key", "reason" }]`, `reason` `secrets_key_missing` (a secret, and `SECRETS_KEY` is not set) or `invalid` (the env value fails the field's validation).

Secret values are never returned or logged.

### `GET /api/settings/history-start`

Query `before` (`YYYY-MM-DD`, required). What applying that date would delete: every stored play, of any kind, on a local day before it. Nothing changes.

```json
{ "plays": 269, "firstDay": "2021-05-16", "lastDay": "2021-09-27", "hours": 11.9 }
```

`firstDay` and `lastDay` are `null` when `plays` is 0. `hours` sums `ms_played` (API rows have none). `400 invalid_request` on a malformed date.

### `POST /api/settings/history-start`

Body `{ "historyStart": "2024-01-01" }`. In this order:

1. Validates the date like `PATCH` would (`400 invalid_settings`: malformed, not a real day, after today in the configured timezone, or `locked` when `HISTORY_START` sets a different date).
2. When plays would be deleted, writes a snapshot of the database with SQLite `VACUUM INTO` to `backups/encore-<UTC timestamp>.db` next to the database file. If it fails: `500 snapshot_failed`, nothing saved, nothing deleted.
3. Saves the setting (skipped when `HISTORY_START` sets this same date).
4. Deletes the plays on a local day before the date, in one transaction. Only `plays` rows: tracks, artists, tags, notes and every other table stay.

`200`: the `GET /api/settings` shape plus `removed` (the `GET /api/settings/history-start` shape, counted inside the delete) and `snapshot` (the file name, or `null` when nothing was deleted). Running it again with the same date deletes nothing and writes no snapshot.

Open cleanup proposals keep the play counts in their `evidence` until the next library pass refreshes them. Stored recaps (`/api/digests`) keep their text.

### `POST /api/settings/claude/verify`

Body `{ "apiKey"?: string }` (send `{}` to check the stored key). Asks the Anthropic Models API whether the key can use the configured model. Free, not recorded in the spend ledger, and the key is not stored. `200 { "valid": true, "model" }` or `{ "valid": false, "model", "message" }`. `409 llm_not_configured` when no key is given or set; `502 llm_failed` when the API cannot be reached.

### `POST /api/settings/discord/register`

Body `{}`. Registers the guild commands now. `200 { "registered": 9, "commands": ["now", "..."] }`. `409 discord_not_configured` (application id, public key or owner id missing), `409 discord_registration_unavailable` (bot token or guild id missing), `502 discord_failed`.

## Onboarding

### `GET /api/onboarding`

State of each first-run step after sign-in. The steps before sign-in come from `GET /api/auth/session` (`setupRequired`, `setupTokenConfigured`) and `POST /api/auth/setup/verify`.

```json
{
  "complete": false,
  "order": ["passkey", "spotifyApp", "spotifyConnect", "locale", "import", "claude", "discord", "mcp"],
  "steps": {
    "passkey": { "required": true, "done": true, "passkeys": 1 },
    "spotifyApp": { "required": true, "done": true, "redirectUri": "https://encore.example/callback", "source": "db", "locked": false },
    "spotifyConnect": { "required": true, "done": false, "userId": null, "missingScopes": ["..."] },
    "locale": { "required": true, "done": true, "timezone": "Europe/London", "source": "db", "locked": false, "playsStored": 0 },
    "import": { "required": true, "done": false, "plays": 0, "exportPlays": 0, "lastImportAt": null },
    "claude": { "required": false, "done": false, "source": "default", "locked": false },
    "discord": { "required": false, "done": false, "interactionsUrl": "https://encore.example/api/discord/interactions", "commandsRegistrable": false },
    "mcp": { "required": false, "done": false, "url": "https://encore.example/mcp", "source": "default", "locked": false }
  },
  "secretStorage": { "available": true, "envVar": "SECRETS_KEY" }
}
```

- `complete`: every `required` step is done.
- `spotifyApp`: a client id is set. Register `redirectUri` in the Spotify app. `spotifyConnect`: a grant for that client id exists; start it with `GET /api/spotify/authorize`.
- `locale.done`: the timezone was chosen (env or stored), not left at the default. Choose it before the import; `playsStored` shows whether plays already carry buckets in the old zone.
- `import.done`: at least one export row is stored. Upload with `POST /api/import`.
- `claude.done`: a Claude key is set (not verified; use `POST /api/settings/claude/verify`). `discord.done`: application id, public key and owner id are set; put `interactionsUrl` in the Discord app. `mcp.done`: an MCP token is set.

## Spotify

### `GET /api/spotify/authorize`

Query: `return` (`setup` or `settings`, default `settings`): where the callback sends the browser back to. `{ "url": "https://accounts.spotify.com/authorize?..." }`. Navigate the browser to `url` (full page, not fetch). PKCE, state valid 10 minutes. `409 spotify_not_configured` while no Spotify client id is set.

### `GET /callback` (public, Spotify redirects here)

Exchanges the code and redirects (302) back to where the flow started: `PUBLIC_BASE_URL/setup?step=spotifyConnect&spotify=<result>` for `return=setup`, `PUBLIC_BASE_URL/settings/spotify?spotify=<result>` otherwise (also for an unknown or forged state). `<result>` is `connected`, `error` (bad state or token exchange failed) or `denied` (owner declined). The target comes from a fixed list, never from the request.

### `POST /api/spotify/disconnect`

Deletes stored tokens. `{ "connected": false }`. A revoked refresh token also disconnects automatically.

### `POST /api/spotify/poll`

Runs the recently-played poll now. `200 { "received": 50, "inserted": 3, "skippedCoveredByExport": 0 }`. `409 spotify_not_connected`; `502 poll_failed` with the reason in `message` (for example a pause).

## Import

### `POST /api/import`

Session or `Authorization: Bearer <ADMIN_TOKEN>`.

`multipart/form-data`, field `files` repeated once per file. Accepts `Streaming_History_Audio_*.json` and `Streaming_History_Video_*.json`; other files are listed in `ignoredFiles`. Max 30 files, 50 MB each. Runs synchronously (about 1-2 s for the full export).

```json
{
  "files": [{ "name": "Streaming_History_Audio_2025.json", "kind": "audio", "rows": 12000, "invalid": 0 }],
  "ignoredFiles": ["ReadMeFirst_ExtendedStreamingHistory.pdf"],
  "rowsParsed": 39811,
  "invalidRows": 0,
  "inserted": 39811,
  "alreadyPresent": 0,
  "beforeHistoryStart": 0,
  "apiPlaysRemoved": 0,
  "range": { "from": "2021-05-16T06:56:32.000Z", "to": "2026-11-12T21:31:26.000Z" }
}
```

`beforeHistoryStart` counts rows on a local day before the `historyStart` setting; they are not stored. `alreadyPresent` counts the other rows that were already stored. `range` spans the rows inside the history start.

Rows that fail validation are counted in `invalid` and skipped. A file that is not a JSON array is a `400 invalid_export` and nothing is written. `415 multipart_required`, `400 no_files`, `400 too_many_files`, `413 file_too_large`.

## Stats

All under `/api/stats`. All accept `from`/`to` unless noted.

### `GET /api/stats/overview`

```json
{
  "hours": 1444.74, "plays": 39338, "listens": 25093, "uniqueTracks": 5055, "uniqueArtists": 1589,
  "skipRate": 0.504, "shuffleRate": 0.716,
  "firstPlayed": "2021-05-16T06:56:32.000Z", "lastPlayed": "2026-11-13T21:07:27.573Z",
  "topArtist": { "artist": "Mac Miller", "imageUrl": "https://i.scdn.co/image/...", "hours": 118.48, "listens": 1889 },
  "topTrack": { "songKey": "glimpse of us|joji", "uri": "spotify:track:3aBGKDiAAvH2H7HLOyQ4US", "name": "Glimpse of Us", "artist": "Joji", "albumArtUrl": "...", "hours": 9.6, "listens": 137 }
}
```

`uniqueTracks` counts songs (merged). `topArtist`/`topTrack` are by hours and are `null` for an empty range.

### `GET /api/stats/timeseries`

Params: `period`. Only buckets with plays are returned (fill gaps on the client).

`{ "period": "month", "points": [{ "period": "2026-01", "hours": 62.1, "plays": 1650, "listens": 980 }] }`

### `GET /api/stats/top/artists` | `/top/tracks` | `/top/albums`

Params: `limit` (1-200, default 50), `offset` (default 0), `sort` = `hours` (default) | `listens` | `plays`. `q` (1-200 chars) keeps rows whose name contains it, case-insensitive: the artist name for artists, the song or artist name for tracks, the album or artist name for albums. Stats still count every play of the row in the range. `top/artists` and `top/tracks` also take `weekday` (1-7) and `hour` (0-23) to count only plays in that local weekday and/or hour (one `clock` cell).

- artists: `{ "items": [{ "artist": "Mac Miller", "imageUrl": "...", "songs": 120, ...Stats }] }`
- tracks: `{ "items": [Song] }`
- albums: `{ "items": [{ "album": "Circles", "artist": "Mac Miller", "albumArtUrl": "...", "songs": 14, ...Stats }] }`

### `GET /api/stats/eras`

Params: `limit` (1-30, default 10) top artists by hours. Stacked-chart ready: `series[i].hours[j]` is the hours of that artist in `months[j]`.

```json
{
  "months": ["2026-10", "2026-11"],
  "series": [{ "artist": "Mac Miller", "hours": [5.68, 0.61] }],
  "artists": [{ "artist": "Mac Miller", "imageUrl": "...", "hours": 6.29, "firstPlayed": "...", "lastPlayed": "...", "peakMonth": "2026-10", "peakMonthHours": 5.68 }]
}
```

`months` spans the first to last month in which any of these artists played in the range. Empty range: all arrays empty.

### `GET /api/stats/clock`

Always 168 cells (7 weekdays x 24 hours, Monday 00 first):

`{ "cells": [{ "weekday": 1, "hour": 0, "hours": 3.2, "plays": 80 }] }`

### `GET /api/stats/devices`

Params: `period`.

```json
{ "period": "year",
  "totals": [{ "device": "ios", "hours": 1321.91, "plays": 36813, "share": 0.915 }],
  "series": [{ "period": "2021", "device": "console", "hours": 11.85, "plays": 265 }] }
```

`share` is the share of hours. `totals` is sorted by hours.

### `GET /api/stats/skips`

Params: `minPlays` (default 10, plays with a known skip flag needed to appear in a list), `limit` (1-200, default 50).

```json
{
  "minPlays": 10,
  "summary": { "plays": 39338, "skips": 19820, "skipRate": 0.504, "quickSkips": 10466 },
  "mostSkippedTracks": [Song],
  "mostSkippedArtists": [{ "artist": "CeeLo Green", "imageUrl": null, ...Stats }],
  "quickSkips": [Song],
  "neverSkipped": [Song],
  "profile": SkipProfile,
  "positions": [{ "start": 0, "end": 0.1, "skips": 5210 }]
}
```

`mostSkipped*` sort by skip rate, then volume. `quickSkips` sorts by quick-skip count. `neverSkipped` is songs with 0 skips, sorted by plays. `profile` is the skip rate per context value over every play in the range with a known skip flag (see Context dimensions). `positions` is always 10 entries: skipped plays by the share of the song played before the skip (`start` inclusive, `end` exclusive; a play longer than the song counts in the last entry). Skips of songs without a known duration are left out, so `positions` can sum to less than `summary.skips`.

### `GET /api/stats/skips/split`

Wrong moment vs dislike, see the definition above. Params: `minPlays` (2-1000, default 8), `minContextPlays` (default 5), `limit` (1-500, default 100), `class` = `keeper` | `wrong_moment` | `dislike` | `mixed` (optional filter on `songs`; `counts` always covers all classes).

```json
{
  "params": { "minPlays": 8, "minContextPlays": 5, "keeperBelow": 0.25, "dislikeAtLeast": 0.75, "worksAtMost": 0.333, "failsAtLeast": 0.667 },
  "eligibleSongs": 1440,
  "counts": { "keeper": 112, "wrong_moment": 205, "dislike": 308, "mixed": 815 },
  "songs": [{
    ...Song,
    "class": "wrong_moment",
    "bestContext": { "dimension": "hourBucket", "value": "night", "plays": 11, "skips": 3, "skipRate": 0.273 },
    "worstContext": { "dimension": "hourBucket", "value": "morning", "plays": 21, "skips": 15, "skipRate": 0.714 }
  }]
}
```

`songs` is sorted by plays. `bestContext`/`worstContext` are `null` when no context reaches `minContextPlays`. The split uses rows with a known skip flag (export and live), so `plays` here counts only those. `params` are the exact thresholds used (unrounded in the response).

### `GET /api/stats/forgotten`

No range. Params: `days` (default 90), `minListens` (default 10), `limit` (default 50).

`{ "days": 90, "minListens": 10, "asOf": "...", "items": [Song] }` sorted by listens. Stats are all-time.

### `GET /api/stats/on-this-day`

No range. Params: `date` (`YYYY-MM-DD`, default today in `TIMEZONE`), `limit` (top tracks per year, default 5). Returns the same month-day in earlier years, newest first; years without plays are absent.

`{ "date": "2026-11-14", "years": [{ "year": 2025, "day": "2025-11-14", "hours": 4.08, "plays": 94, "listens": 69, "topTracks": [Song] }] }`

`topTracks` are sorted by listens, with stats for that day only.

### `GET /api/stats/trips`

Params: `minPlays` (default 5), `topTracks` (0-50, default 5). Newest first.

```json
{ "homeCountry": "GB",
  "trips": [{
    "start": "2026-02-05T23:06:55.000Z", "end": "2026-02-09T10:54:42.000Z", "startDay": "2026-02-06", "endDay": "2026-02-09", "days": 4,
    "countries": [{ "country": "GB", "plays": 39 }, { "country": "TR", "plays": 15 }],
    "plays": 54, "hours": 2.96,
    "topTracks": [{ "songKey": "piano man|billy joel", "uri": "spotify:track:...", "name": "Piano Man", "artist": "Billy Joel", "albumArtUrl": "...", "plays": 2, "listens": 2, "hours": 0.19 }]
  }] }
```

The range filters plays before trips are built, so a trip that crosses `from`/`to` is cut at the boundary.

### Tag-based stats

Work with zero tags (empty `totals`/`series`, `null` energy). Tags attach to songs; untagged plays are left out, so check `coverage`.

- `GET /api/stats/tags/genres` and `GET /api/stats/tags/moods`, params `period`:

  ```json
  { "period": "month",
    "coverage": { "hoursTagged": 0, "hoursTotal": 1444.74, "share": 0 },
    "totals": [{ "value": "hip-hop", "hours": 300.2, "plays": 8000 }],
    "series": [{ "period": "2026-01", "value": "hip-hop", "hours": 20.1, "plays": 500 }] }
  ```

  A song with 2 genres counts its full hours toward both, so values can sum to more than the total.

- `GET /api/stats/tags/energy`: average energy and valence (1-5) of tagged listens per local hour. Always 24 entries.

  `{ "coverage": {...}, "hours": [{ "hour": 0, "energy": 3.4, "valence": 2.9, "listens": 120 }] }` (`energy`/`valence` are `null` when `listens` is 0).

## Entities

All accept `from`/`to` and `period` (timeline bucket, default `month`). `404 not_found` when the entity has no music plays in the range.

### `GET /api/entities/artist?name=Mac%20Miller`

```json
{ "artist": "Mac Miller", "imageUrl": "...", "totals": Stats,
  "timeline": [{ "period": "2025-01", "hours": 10.2, "plays": 300, "listens": 200 }],
  "skipProfile": SkipProfile,
  "tracks": [Song],
  "albums": [{ "album": "Circles", "albumArtUrl": "...", ...Stats }] }
```

`tracks` is the top 50 songs by hours.

### `GET /api/entities/album?artist=Mac%20Miller&album=Circles`

`{ "album": "Circles", "artist": "Mac Miller", "albumArtUrl": "...", "totals": Stats, "timeline": [...], "skipProfile": SkipProfile, "tracks": [Song] }`

### `GET /api/entities/track?songKey=...` or `?uri=spotify:track:...`

Merged across URIs: any URI of the song gives the same page.

```json
{ ...Song, "totals": Stats, "timeline": [...], "skipProfile": SkipProfile,
  "class": "wrong_moment",
  "uris": [{ "uri": "spotify:track:...", "name": "Song A", "album": "Album", "plays": 120 }] }
```

`class` uses the split rules with `minContextPlays = 3`, or is `null` with fewer than 8 plays with a known skip flag.

## Search

### `GET /api/search?q=...`

Case-insensitive substring match over all music plays (no range). Params: `q` (1-200 chars, required), `limit` per group (1-50, default 8). Each group is sorted by listens. Artists match on artist name, songs on track name (merged by `songKey`), albums on album name. Stats are all-time.

```json
{ "artists": [{ "artist": "Mac Miller", "imageUrl": "...", ...Stats }],
  "songs": [Song],
  "albums": [{ "album": "Circles", "artist": "Mac Miller", "albumArtUrl": null, ...Stats }] }
```

## History

### `GET /api/history`

Newest first. Params (all optional): `from`, `to`, `kind` (default `track`), `artist` (exact), `songKey`, `uri` (exact track URI), `device`, `skipped` (`true`/`false`), `country` (2-letter), `source`, `q` (case-insensitive substring of track, artist, album, episode, or show name), `limit` (1-500, default 100), `offset`.

```json
{ "total": 39338, "limit": 1, "offset": 0,
  "items": [{ "id": 79623, "ts": "2026-11-13T21:07:27.573Z", "day": "2026-11-14", "hour": 0, "kind": "track",
              "uri": "spotify:track:...", "songKey": "do i wanna know|arctic monkeys", "name": "Do I Wanna Know?", "artist": "Arctic Monkeys",
              "album": "AM", "albumArtUrl": "...", "msPlayed": null, "skipped": null, "shuffle": null,
              "reasonStart": null, "reasonEnd": null, "device": "unknown", "country": null, "source": "api" }] }
```

For episodes, `name` is the episode, `artist` the show, `uri` the episode URI, `songKey` `null`. `ts` is the end of the play (Spotify's export and recently-played both report end time).

## Tracks

### `GET /api/tracks?uri=spotify:track:...&uri=...`

Identities for 1-500 track URIs (repeat `uri`), for lists that arrive as URIs only (DJ sessions). Unknown URIs are left out; order is not kept.

`{ "items": [{ "uri": "spotify:track:...", "songKey": "glimpse of us|joji", "name": "Glimpse of Us", "artist": "Joji", "album": "SMITHEREENS", "albumArtUrl": "..." }] }`

## Tags

Session or `Authorization: Bearer <ADMIN_TOKEN>`. Tags belong to a song (`songKey`): tagging one URI tags all URIs of the song.

### `GET /api/tags/vocabulary`

```json
{ "genres": ["hip-hop", "rnb", "soul", "funk", "pop", "indie", "alternative", "rock", "metal", "punk", "electronic", "dance", "house", "techno", "ambient", "lo-fi", "jazz", "blues", "classical", "soundtrack", "folk", "country", "singer-songwriter", "latin", "reggae", "afrobeats", "k-pop", "arabic", "gospel", "experimental"],
  "moods": ["happy", "euphoric", "energetic", "confident", "romantic", "sensual", "chill", "calm", "dreamy", "nostalgic", "melancholic", "sad", "angry", "dark", "introspective", "focused"],
  "confidence": ["low", "med", "high"],
  "energy": { "min": 1, "max": 5 }, "valence": { "min": 1, "max": 5 },
  "language": "ISO 639-1 code or 'instrumental'" }
```

### `GET /api/tags/pending`

Untagged songs that have music plays, one representative URI (the most played) per song, most listened first. Params: `limit` (1-500, default 100), `offset`.

`{ "items": [{ "uri": "spotify:track:...", "name": "Glimpse of Us", "artist": "Joji", "album": "Glimpse of Us", "listens": 137 }], "total": 5055, "limit": 100, "offset": 0 }`

### `POST /api/tags`

Bulk upsert, 1-500 items, all or nothing.

```json
{ "tags": [{
  "uri": "spotify:track:3aBGKDiAAvH2H7HLOyQ4US",
  "genres": ["pop", "rnb"],
  "subgenre": "bedroom pop",
  "moods": ["melancholic", "introspective"],
  "energy": 2,
  "valence": 1,
  "language": "en",
  "model": "claude-x",
  "confidence": "high",
  "taggedAt": "2026-11-14T00:00:00Z"
}] }
```

Rules: `genres` and `moods` 1-3 distinct values from the vocabulary; `subgenre` optional free text up to 60 chars; `energy`, `valence` integers 1-5; `language` a valid ISO 639-1 code or `instrumental`; `model` 1-100 chars; `confidence` `low`/`med`/`high`; `taggedAt` optional ISO datetime (default now). Unknown keys are rejected. `200 { "upserted": 1 }`. `400 invalid_request` with `details[].path` like `tags.0.genres.0`; `400 unknown_tracks` with `details.uris` when a URI is not in the library.

## Player

Playback goes through the owner's Spotify account (Premium) on its active device. Controls return `409 no_active_device` when no device is active and accept an optional `deviceId` (from `/devices`) to target one.

### `GET /api/player/now`

From the watcher's cache: no Spotify call while the `watch` job runs. With the job disabled, a cache older than `WATCHER_IDLE_SECONDS + 5` refreshes it once.

```json
{ "playing": true,
  "track": { "uri": "spotify:track:...", "name": "Glimpse of Us", "artist": "Joji", "album": "SMITHEREENS", "albumArtUrl": "https://i.scdn.co/image/...", "durationMs": 233000 },
  "progressMs": 61000, "shuffle": false, "device": { "name": "iPhone", "type": "Smartphone" },
  "contextUri": "spotify:playlist:...", "fetchedAt": "..." }
```

`progressMs` is extrapolated from `fetchedAt` while playing. Nothing playing: `playing: false`, `track: null`.

### `GET /api/player/devices`

`{ "devices": [{ "id": "...", "name": "iPhone", "type": "Smartphone", "active": true, "restricted": false, "volume": 60 }] }`

### `GET /api/player/queue`

`{ "current": { "uri": "...", "name": "...", "artist": "...", "albumArtUrl": "..." } | null, "queue": [same shape] }`

### Controls

All `POST`, all answer `200 { "ok": true }`.

| Route | Body |
| --- | --- |
| `/api/player/play` | `{ "contextUri"?: album/playlist/artist URI, "uris"?: [track URI] (1-100), "offset"?: { "position": n } \| { "uri": track URI }, "deviceId"? }`. Not both `contextUri` and `uris`. Empty body resumes. |
| `/api/player/pause` | `{ "deviceId"? }` or no body |
| `/api/player/next` | `{ "deviceId"? }` or no body |
| `/api/player/queue` | `{ "uri": track URI, "deviceId"? }` |
| `/api/player/shuffle` | `{ "state": boolean, "deviceId"? }` |
| `/api/player/transfer` | `{ "deviceId": string, "play"?: boolean }` |

## DJ session

Plays an ordered list of songs through the app-owned playlist "encore session" with shuffle off. Spotify cannot reorder or clear the user queue, so the session rewrites the playlist's not-yet-played tail instead. The watcher tracks the position. After `DJ_SKIP_TRIGGER` (default 2) consecutive skips inside the playlist, the re-planner returns a new tail; the session deletes the old tail items and appends the new ones. Played songs and the current song are never touched. Songs appear once per session (duplicates are dropped at start). Playing anything outside the playlist ends the session.

Default re-planner (deterministic): keeps the remaining tail minus songs classed `dislike` and songs already skipped in the session, scores each by context fit for the current local hour bucket and day type (1 - skip rate, from plays with a known skip flag, needs 3 plays, else 0.5) plus tag similarity to finished songs minus tag similarity to skipped ones (genres, moods, energy, valence), and orders by score. Dropped songs are replaced from the owner's 300 most listened tagged songs that score above neutral.

Claude re-planner: with `DJ_REPLANNER=llm` (default `deterministic`), the deterministic re-planner runs first, then Claude orders the remaining planned songs plus the deterministic list, given what was finished and skipped this session, the song playing now and the taste profile (feature `dj` in the ledger, effort low). Any failure falls back to the deterministic list: no API key, budget spent, refusal, no answer, or no answer within `DJ_REPLAN_TIMEOUT_SECONDS` (default 20).

A re-plan reads the session again after the re-planner returns and cuts the tail at the position it finds then, so a song that became current while the re-plan ran is never removed.

Seam: `DjService.setReplanner(fn)` with `fn(input: { finished, skipped, current, upcoming, exclude, now }) => Promise<string[]>` (track URIs). Returned URIs that are played, current or invalid are dropped.

### `POST /api/dj/start`

Body `{ "uris": [track URI] (1-500), "deviceId"? }`. Replaces any active session. `400 invalid_set`, `409 no_active_device`.

```json
{ "session": { "id": 3, "status": "active", "playlistUri": "spotify:playlist:...", "position": 0, "current": "spotify:track:...",
  "upcoming": ["spotify:track:..."], "played": [{ "uri": "spotify:track:...", "outcome": "skipped" }],
  "skipStreak": 0, "replans": 0, "replannedAt": null, "replanSkips": null, "set": null, "startedAt": "...", "endedAt": null, "endReason": null } }
```

### `GET /api/dj`

`{ "session": Session | null }`: the active session, else the latest one. `status` is `active`, `stopped` or `ended`; `endReason` is `stopped`, `replaced` or `left_playlist`. `played[].outcome` is `finished` or `skipped`, from the watcher's live plays (inferred skip, see Live plays). `skipStreak` counts consecutive skips; `replans` counts re-plans this session; `replannedAt` is the time of the last re-plan and `replanSkips` the skips in a row that triggered it (both `null` before the first). `set` is `{ id, title }` when the session was started from a set.

Start latency: starting a session makes about 4 Web API calls (playlist items, shuffle off, play), so with the default pacing it takes about 6 s (computed from `SPOTIFY_MIN_INTERVAL_MS`, not measured).

### `POST /api/dj/stop`

Ends the session (playback continues). `404` when none is active.

## Release radar

The `radar` job checks artists with at least `RADAR_MIN_LISTENS` (20) listens in the last 12 months, `RADAR_ARTISTS_PER_RUN` (2) Web API calls per run every `RADAR_INTERVAL_MINUTES` (60), each artist at most every `RADAR_RECHECK_DAYS` (7). Never-checked artists go first, then the longest unchecked, most listened first. An artist without a known Spotify id costs one `GET /tracks/{id}` on their most played track to learn it. A check is `GET /artists/{id}/albums?include_groups=album,single&limit=10`, plus one `include_groups=single` call when albums fill that page.

A release is **new** when it was not stored before and its release date is on or after the day before the artist's previous check; on an artist's first check, within `RADAR_BASELINE_DAYS` (30). Year- and month-precision dates count as the first day of the period.

### `GET /api/radar`

Params: `status` = `new` (default: new and not marked seen) | `recent` (released in the last `days`), `days` (1-365, default 30), `limit` (1-200, default 50). Sorted by release date, newest first.

```json
{ "artists": 66, "withId": 47, "checkedRecently": 12, "unseenNew": 3, "lastRunAt": "...", "lastResult": { "due": 54, "checked": 2, "resolved": 0, "unresolved": 0, "found": 18, "newReleases": 1, "calls": 2 },
  "items": [{ "id": "...", "uri": "spotify:album:...", "url": "https://open.spotify.com/album/...", "name": "...", "artist": "...", "artistId": "...",
              "albumType": "single", "releaseDate": "2026-11-07", "totalTracks": 1, "imageUrl": "https://i.scdn.co/image/...", "isNew": true, "seen": false, "firstSeenAt": "..." }] }
```

### `POST /api/radar/seen`

Body `{ "ids"?: [release id] }`; without `ids`, marks every unseen new release. `{ "marked": 3 }`.

For the weekly digest: `newReleasesSince(db, sinceMs)` in `src/radar/radar.ts` returns releases flagged new and first seen at or after `sinceMs`, seen or not.

## Shares

Public, read-only links to a frozen copy of a recap. The security model is in [sharing.md](sharing.md). Kinds: `recap` (more later).

### `POST /api/shares`

Body `{ "kind": "recap", "ref": 12, "expiresInDays"?: 1-365 | null }` (`ref` is the recap id). Copies the recap page into a snapshot and makes a link. `201 { "share": Share, "url": "https://encore.example/s/<token>" }`. `url` is in this answer only: encore stores the token's SHA-256, not the token. `404` for an unknown recap.

Share shape: `{ "id": 1, "kind": "recap", "ref": 12, "createdAt": "...", "expiresAt": "..." | null, "revokedAt": "..." | null, "views": 3, "lastViewedAt": "..." | null, "status": "active" | "expired" | "revoked" }`.

### `GET /api/shares`

Params `kind`, `ref` (both optional). `{ "items": [Share] }`, newest first.

### `DELETE /api/shares/:id`

Revokes the link for good: from then on it answers like an unknown one. `{ "share": Share }`. Revoking twice is a no-op. `404` for an unknown id.

### `GET /s/:token` (public)

The shared page: server-rendered HTML with no script, the same for every visitor (the session cookie is never read). Each `GET` counts a view. `og:` and `twitter:` tags point at `PUBLIC_BASE_URL/s/<token>/card.png`. Headers: `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, the app's CSP. A malformed, unknown, revoked or expired token gets the same `404` page. `429` past 60 requests a minute per client or 1200 a minute in all, on every `/s/*` route.

### `GET /s/:token/card.png` (public)

The 1200 x 630 card, drawn from the snapshot once and kept in memory. `404` as above.

### `GET /s/:token/snapshot.json` (public)

The snapshot the page is drawn from (fields listed in [sharing.md](sharing.md#what-the-snapshot-holds)). `404` as above.

## Living playlists

Six private playlists in the owner's Spotify account that encore keeps refilling. Each kind has one Spotify playlist for good: made the first time it is switched on, then always updated in place. Off by default. Switching off stops refreshes and leaves the playlist in Spotify; encore never deletes or unfollows it.

| Kind | Name | Holds | Refresh | Mode |
| --- | --- | --- | --- | --- |
| `picks` | Weekly picks | The latest week of picks, without `never` picks | After a picks run, a pick state change, and every job tick | replace |
| `forgotten` | Forgotten favourites | Songs with 10+ listens and none in 90 days (`stats/forgotten`), most listened first | Weekly (from Monday, local) | rolling, 10 per refresh |
| `most-played` | Most played lately | Most listens in the last 28 local days, at least 2 | Daily (local) | replace |
| `new-releases` | New from your artists | The first 3 tracks of each new release (radar) from the last 90 days, newest first | Every job tick | rolling |
| `this-month` | This month in past years | Most listens in this calendar month of earlier years | Monthly (the 1st, local) | replace |
| `this-year` | This year so far | The songs that defined the year so far, by the recap playlist rule (most listens, then most time, at least 2) | Weekly (from Monday, local), and on 1 January | replace |

- At most 50 songs, distinct by song key. Replace rebuilds the list. Rolling puts new songs on top and drops the oldest past 50; it fills an empty playlist to 50, then adds at most its per-refresh count, and never adds a song that playlist already had.
- A refresh writes nothing when the list is unchanged, when the new list is empty (the playlist keeps its songs), or while the playlist is the playback context the player watcher last saw (`deferred`, retried on the next tick). A skip never removes a song or moves it down: rankings count listens, and rolling lists drop songs only at the cap.
- Spotify calls: making the playlist is 3 (create, items, cover); a change is 2 (details, items); no change is 0. The cover is uploaded once, and again only when its drawing changes. New from your artists also costs one album tracks call (`GET /albums/{id}/tracks?limit=3`) per new release, once, at most 3 per tick. No single track or artist lookups.
- The Spotify description says what the playlist holds and the local date it last changed: `Your most played songs of the last four weeks. Updated 14 Nov 2026 by encore.`
- A playlist deleted in Spotify is found without a call of its own: a write that answers 404, or a library pass (`library` job) that lists the owner's playlists without it. It is switched off with `removedAt` set; switching on again makes a new playlist.
- The `living` job ticks every 10 minutes (`JOBS_DISABLED=living` turns it off) and refreshes the kinds that are due. A failed refresh is retried after an hour.
- Writing needs the `playlist-modify-private` scope, the cover `ugc-image-upload`.
- This year so far makes no playlist while the year has no song listened to twice. At its first refresh in a new year it closes the year it holds: the songs are set to that whole year, the playlist is renamed after the year ("2026") with the year's recap cover and description, recorded as that year's recap playlist (`source: "living"`, see Digests), and a change with trigger `year-end` is added to its history. The same refresh then starts a new This year so far for the new year once it has songs. Closing waits while the playlist is playing. When the year already has a recap playlist saved from its page, nothing is closed and the playlist carries on into the new year. Calls: 2 (details, items) plus the cover.

Living playlist shape:

```json
{
  "kind": "most-played", "name": "Most played lately", "about": "Your most played songs of the last four weeks",
  "mode": "replace", "schedule": "daily", "cap": 50, "enabled": true,
  "playlist": { "id": "...", "url": "https://open.spotify.com/playlist/..." } | null,
  "removedAt": null, "coverUrl": "/api/living/most-played/cover?v=...",
  "status": "refreshed" | "unchanged" | "empty" | "deferred" | "failed" | "removed" | null, "error": null,
  "attemptedAt": "...", "checkedAt": "...", "changedAt": "...", "nextRefresh": "2026-11-15" | null,
  "count": 50, "available": 50
}
```

`schedule` is `daily`, `weekly`, `monthly`, `yearly-weekly` (weekly, and when the year turns), `picks` or `releases`. `checkedAt` is the last refresh that reached a result (refreshed, unchanged, empty); `changedAt` the last one that changed the playlist. `nextRefresh` is the local day of the next scheduled refresh, `null` while off and for `picks` and `releases`. `count` is the number of songs encore last put in the playlist; `available` what a refresh now would put in it.

### `GET /api/living`

`{ "spotify": { "connected": true, "canWrite": true, "canUploadCovers": true }, "items": [LivingPlaylist] }`, in the order of the table above.

### `GET /api/living/:kind`

`LivingPlaylist` plus `items` (the songs in it now, in order, as `{ uri, songKey, name, artist, album, albumArtUrl, artistImageUrl }`), `preview` (while `items` is empty: what a refresh would put in it) and `history` (the last 30 changes, newest first: `{ id, at, trigger: "enable" | "schedule" | "manual" | "picks" | "year-end", count, added: [Song], removed: [Song], current }`; `current` is false for changes to a playlist since deleted in Spotify).

### `GET /api/living/:kind/refreshes/:id`

The full contents a change left: `{ id, at, trigger, items, added, removed }`. `404` when unknown.

### `GET /api/living/:kind/cover`

The fixed cover JPEG, the same image the playlist has in Spotify. Cached for good at the versioned `coverUrl`.

### `PATCH /api/living/:kind`

Body `{ "enabled": boolean }`. Switching on makes the playlist when there is none (or it was deleted) and fills it. `{ "outcome": { "kind", "status": LivingStatus | "off", "calls": 3, "cover"?: "uploaded" | "unchanged" | "missing_scope" | "failed" }, "playlist": LivingPlaylist with items }`. `409 spotify_not_connected`, `409 missing_scope` (`details.scope`). A Spotify failure is not an error response: `outcome.status` is `failed` and `playlist.error` says why.

### `POST /api/living/:kind/refresh`

Refresh now, with the same rules and response as switching on. `outcome.status` is `off` when the kind is off.

## Cleanup

Proposals only; nothing is removed until the owner applies a selected batch here. The `library` job syncs saved songs (`GET /me/tracks`) and the items of playlists the owner owns (`GET /me/playlists`, then `GET /playlists/{id}/items` for playlists whose snapshot changed), one page call every `LIBRARY_PAGE_SECONDS` (20), a full pass every `LIBRARY_SYNC_HOURS` (24). The cursor is stored, so a restart resumes the pass. App-owned playlists are skipped. Proposals are rebuilt after each pass; dismissed and applied ones keep their status.

Kinds (stats are all-time over the song, merged by `songKey`):

- `saved_never_played`: saved more than 30 days ago, no play of the song.
- `saved_dislike`: saved song classed `dislike` by the skip split (8+ plays with a known skip flag) AND a listen ratio of 0.2 or less. Listen ratio = listens / plays over all sources (a listen is 30 s or more, or any API row; see Metric definitions). The ratio rule keeps songs that are often skipped but still often listened through (for example 5 listens of 8 plays).
- `playlist_skipped`: song in an own playlist with 8+ plays with a known skip flag and a skip rate of 0.9 or more.
- `playlist_duplicate`: the same song more than once in one playlist; applying keeps the first.

### `GET /api/cleanup`

Params: `kind`, `status` = `open` (default) | `dismissed` | `applied`, `limit` (1-500, default 100), `offset`.

```json
{ "counts": { "saved_never_played": 210, "saved_dislike": 31, "playlist_skipped": 12, "playlist_duplicate": 4 },
  "library": { "savedTracks": 1979, "playlists": 23, "syncing": false, "lastSyncAt": "..." },
  "total": 210, "limit": 100, "offset": 0,
  "items": [{ "id": 17, "kind": "saved_dislike", "playlistId": null, "uri": "spotify:track:...", "status": "open", "updatedAt": "...",
              "evidence": { "name": "...", "artist": "...", "albumArtUrl": "...", "songKey": "...", "plays": 14, "listens": 2, "skips": 12, "skipRate": 0.857,
                            "listenRatio": 0.143, "lastPlayed": "...", "savedAt": "...", "class": "dislike" } }] }
```

`counts` are open proposals. Playlist kinds add `playlistId`, `playlistName` to `evidence`; `playlist_skipped` adds `positions` and `uris`; `playlist_duplicate` adds `keep: { position, uri }` and `duplicates: [{ position, uri }]`.

### `POST /api/cleanup/dismiss`

Body `{ "ids": [proposal id] }`. `{ "dismissed": 2 }`.

### `POST /api/cleanup/apply`

Body `{ "ids": [proposal id] }` (1-500, all must be open, else `400 invalid_selection` with `details.ids`). The only code path that removes from the library (`DELETE /me/library`) or an owned playlist (`DELETE /playlists/{id}/items`, which removes every occurrence of a URI; duplicates re-add the kept one at its position). Proposals run in order; the undo log records what each removed. `200 { "batchId": 4, "applied": 3 }`. A Spotify failure part way returns `502 cleanup_partial` with `details.batchId`: the batch holds what was applied before it.

### `GET /api/cleanup/batches`

`{ "items": [{ "id": 4, "proposalIds": [17, 18], "actions": 2, "appliedAt": "...", "undoneAt": null }] }`

### `POST /api/cleanup/batches/:id/undo`

Saves removed songs back to the library and re-inserts removed playlist items at their original positions (ascending). Proposals return to `open`. `{ "batchId": 4, "restored": 2 }`. Re-saved songs get a new "added" date. Undo assumes the playlist did not change since; undoing an older batch after a newer one on the same playlist can misplace items.

## Discord

No gateway connection. Set `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` and `DISCORD_OWNER_ID` to enable the endpoint, and `DISCORD_BOT_TOKEN` plus `DISCORD_CHANNEL_ID` for channel posts; point the Discord application's Interactions Endpoint URL at `PUBLIC_BASE_URL/api/discord/interactions`.

### `POST /api/discord/interactions` (public)

Every request must carry a valid Ed25519 signature (`X-Signature-Ed25519` over `X-Signature-Timestamp` + raw body, application public key), else `401 invalid_signature`. Answers `PING`. Only `DISCORD_OWNER_ID` may run commands or press buttons; anyone else gets an ephemeral refusal. Commands that may call Spotify answer with a deferred response (type 5) and edit the original message when done, inside Discord's 3 s limit. `404` when Discord is not configured.

Guild commands (registered with a bulk overwrite at startup when `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` are set, or `bun run discord:register`):

| Command | Does |
| --- | --- |
| `/now` | What is playing, with album art (watcher cache) |
| `/play query` | Plays the best match: the owner's history first (most listened song whose name contains `query`), then Spotify search |
| `/queue query` | Same match, added to the queue |
| `/skip` | Next track |
| `/stats [range]` | Hours, listens, skip rate, songs, artists, top artist and song. `range`: `week`, `month` (default, last 30 days), `year`, `all` |
| `/top [kind] [range]` | Top 10 `artists` (default) or `songs` by hours |
| `/onthisday` | Same month-day in earlier years, top 3 songs per year |
| `/forgotten` | 5 forgotten favourites (90 days, 10+ listens), each with a Queue button |
| `/releases` | Unseen new releases from the radar |
| `/cleanup` | Open proposal counts and a link to the dashboard; never applies |
| `/set moment` | Deferred. Builds a set with Claude (up to 1000 chars). Shows the title (links to the dashboard), track count, the first 4 tracks with album art and reasons, and buttons Save to Spotify, Play now, Open in dashboard. If Claude asks a question instead, the question is the message content |
| `/picks` | This week's picks: one embed per pick with album art, reason and source link; per pick (first 5) buttons Save, Not now, Never. Never generates picks |
| `/ask question` | Deferred. Plain-text answer from Claude (up to 1000 chars in, 2000 out) |

Button custom ids are `prefix:arg`:

| Custom id | Does (reply is ephemeral) |
| --- | --- |
| `queue:<track URI>` | Adds the song to the queue |
| `setsave:<set id>` | Saves the set to its private Spotify playlist (same as `POST /api/sets/:id/playlist`) |
| `setplay:<set id>` | Plays the set through a DJ session on the active device (same as `POST /api/sets/:id/play`) |
| `pick:<pick id>:save` | Pick state `saved`, and saves the song to the Spotify library (`PUT /me/library`) |
| `pick:<pick id>:notnow` | Pick state `not_now` |
| `pick:<pick id>:never` | Pick state `never` (blocks as for `PATCH /api/picks/:id`) |

Claude errors are shown as messages: not configured, budget used up (with the amounts), declined, stopped early; unknown sets and picks say "That no longer exists."

Channel posts: with `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` set, the `picks` and `digest` jobs post to the channel after every hourly run: this week's picks (same message as `/picks`, once per week, as soon as picks exist), the newest weekly recap (once per period, while under 8 days old) with an embed of up to 10 radar releases flagged new and first seen since the recap's first day, the newest monthly recap (once per month, while under 32 days old) and the newest finished yearly recap (once per year, while under 32 days old). Each recap post carries its share card (`recap.png`, 1200 x 630) as an attachment shown in the first embed; a card that cannot be drawn is logged and the post goes without it. Dates in posts are written out ("22 Oct 2026"). What was posted is stored in job state `discord_posts` (`{ picks: week, weekly: periodKey, monthly: periodKey, yearly: periodKey }`), so restarts and repeated runs do not post twice. A failed post is retried on the next run.

Seams for other modules (`src/discord/`): `DiscordRegistry.addCommand({ definition, defer, ephemeral?, handle })` and `addComponent({ prefix, defer, ephemeral?, handle })` on `discord.registry` (created in `src/main.ts` by `createDiscord`); handlers get `{ ctx: { db, config, services, now }, interaction, options | arg }` and return a message (`content`, `embeds`, `components`). Throw `UserFacingError` for a message the owner should see. Add commands before `registerCommands` runs. To post outside an interaction (a weekly digest), call `postToChannel(discord, message)` or `discord.rest.postMessage(channelId, message)`; `discord.rest.editMessage` edits it. All messages are sent with `allowed_mentions: { parse: [] }`; pass names through `plain()` (escapes markdown, breaks `@` mentions, truncates).

## MCP

`/mcp` (streamable HTTP, `@modelcontextprotocol/server`, stateless) when `MCP_TOKEN` is set; `404` otherwise. Needs `Authorization: Bearer <MCP_TOKEN>` (`401` without). Tools return JSON text with the same shapes as the HTTP endpoints:

| Tool | Input |
| --- | --- |
| `overview` | `from?`, `to?` |
| `top` | `kind` (`artists`, `songs`, `albums`), `sort?`, `limit?`, `from?`, `to?` |
| `history` | `from?`, `to?`, `artist?`, `songKey?`, `uri?`, `skipped?`, `q?`, `limit?`, `offset?` |
| `lookup` | `query?` (name search) or `artist` (+ `album`) or `songKey`/`uri` (entity page) |
| `on_this_day` | `date?`, `limit?` |
| `forgotten` | `days?`, `minListens?`, `limit?` |
| `now_playing` | none |
| `releases` | `status?` (`new`, `recent`), `days?` |
| `play` | `uris` (1-50 track URIs) |
| `add_to_queue` | `uri` |

There are no library or playlist removal tools.

## Assistant (Claude)

Claude-backed features: sets, weekly picks, ask, liner notes, digests, and the optional DJ re-planner. HTTP routes are session only (the admin token is rejected); the same features are in Discord (see Discord). Every call is recorded in a ledger and priced; see `GET /api/llm/spend`.

### Errors

| Status | `code` | When |
| --- | --- | --- |
| 503 | `llm_not_configured` | No `ANTHROPIC_API_KEY` |
| 402 | `llm_budget_exceeded` | This month's spend reached `MONTHLY_BUDGET_USD`. `details: { month, spentUsd, capUsd }` |
| 422 | `llm_refused` | Claude declined the request. `details: { category }` |
| 502 | `llm_incomplete` | Claude stopped without a result (no set or picks submitted, output cut off) |
| 502 | `llm_failed` | Claude API error after retries |
| 409 | `spotify_not_connected` | A Spotify lookup or playlist write was needed |
| 503 | `spotify_paused` | Spotify rate limit or quota pause. `details: { reason, until }` |
| 502 | `spotify_failed` | Spotify call failed |
| 409 | `picks_exist` | Picks for this week already exist. `details: { week }` |
| 409 | `set_empty` | Saving a set with no tracks |
| 404 | `not_found` | Unknown set, pick, thread, digest, block or note |
| 409 | `period_unavailable` | A recap period that has not ended or that the history does not reach |
| 409 | `playlist_empty` | A recap period with no song listened to twice, so no playlist to save |

### Streaming

`POST /api/sets`, `POST /api/sets/:id/messages`, `POST /api/picks/generate` and `POST /api/ask` return JSON by default. Send `Accept: text/event-stream` to get Server-Sent Events instead:

| Event | `data` |
| --- | --- |
| `text` | `{ "delta": "..." }`: Claude's text as it is written |
| `tool` | `{ "name": "find_songs", "input": { ... } }`: a tool Claude called |
| `done` | The same body the JSON response would have. Last event. |
| `error` | `{ "error": { "code", "message", "details"? } }`. Last event. |

Budget and configuration errors (`402`, `503`) are returned as normal JSON errors before the stream opens. Runs take 10 s to 2+ min (measured: ask 10-14 s, set 63 s, refine 27 s, picks 135 s), so stream or show progress.

### Sets

A set is a playlist built from a free-text request: songs from the owner's history plus verified songs the owner has never played, each with a reason. Refine it by conversation; each accepted change bumps `version`.

Set shape (`GET /api/sets/:id`, and `set` in create/refine):

```json
{
  "id": 1, "title": "Late drive", "description": "Night roads.", "request": "late drive, like my Mac Miller era",
  "version": 2,
  "playlist": { "id": "3xYz...", "url": "https://open.spotify.com/playlist/3xYz...", "savedVersion": 1, "outdated": true },
  "coverUrl": "/api/sets/1/cover?v=e3b78ab8bd4c3322",
  "createdAt": "...", "updatedAt": "...",
  "items": [{
    "position": 1, "kind": "library", "songKey": "woods|mac miller", "uri": "spotify:track:...",
    "name": "Woods", "artist": "Mac Miller", "album": "Circles",
    "albumArtUrl": "https://i.scdn.co/image/...", "artistImageUrl": "https://i.scdn.co/image/...",
    "reason": "Finished 41 of 44 night plays.",
    "pinned": false,
    "history": { "listens": 44, "lastPlayed": "..." },
    "outcome": { "plays": 3, "finished": 2, "skipped": 1, "firstPlayedAt": "..." },
    "dj": { "finished": 1, "skipped": 0 }
  }],
  "djSessions": 1,
  "conversation": [{ "role": "owner", "text": "late drive, ..." }, { "role": "assistant", "text": "..." }],
  "changes": [{ "version": 2, "source": "claude", "message": "less sad", "at": "...",
                "added": [{ "songKey": "...", "name": "...", "artist": "..." }], "removed": [], "moved": [{ "songKey": "...", "name": "...", "artist": "...", "from": 5, "to": 2 }] }]
}
```

- `kind`: `library` (in the history) or `new` (never played, verified on Spotify).
- `albumArtUrl`, `artistImageUrl`: artwork for the row, or `null` when not known yet. Album art comes from any known version of the song (or the Spotify search result for new songs); the artist image is the primary artist's. Picks and notes carry the same two fields.
- A refinement that changes mood or direction ("less sad") is applied to every track: familiar songs whose tags conflict with it are rejected unless the owner asked to keep them.
- `playlist` is `null` until saved. `outdated: true` when the set changed after the last save; saving again updates the same playlist.
- `coverUrl`: the set's generated cover (see `GET /api/sets/:id/cover`), `null` while the set has no tracks. `v` changes whenever the cover would change.
- `outcome` counts plays of the song after the set was saved (or created, if never saved), from all sources: `finished` uses the skip flag and play time of export and live rows; API rows count as finished. Refreshed hourly.
- `history`: for `library` tracks, the owner's all-time listens and last play of the song; `null` for `new` tracks.
- `pinned`: the owner pinned the track. A refinement that leaves out a pinned track is rejected and Claude must keep it; Claude is told which tracks are pinned with every refinement.
- `changes`: one entry per version after the first, oldest first. `source` is `claude` (a refinement; `message` is the owner's message) or `owner` (a track removed by hand; `message` is `null`). `moved` lists kept songs whose order relative to the other kept songs changed (songs only shifted by an insert or removal are not listed); `from` and `to` are 1-based positions.
- `dj`: `{ finished, skipped }` for this track across the DJ sessions started from the set (`POST /api/sets/:id/play` or the Discord Play now button), from the watcher's live plays. `djSessions` on the set counts those sessions.

#### `POST /api/sets`

`{ "request": "late drive, like my Mac Miller era, half songs I've never heard" }` (1-2000 chars). `201 { "set": Set, "reply": null }`. `reply` is text when Claude asks a question instead of building; the set then has `version: 0` and no items, and the owner answers via `POST /api/sets/:id/messages`.

#### `POST /api/sets/:id/messages`

`{ "message": "less sad, and swap track 3 for something more upbeat" }`. `200 { "set": Set, "changed": true, "reply": null }`. `changed: false` with a `reply` when Claude answered without changing the set.

#### `GET /api/sets`

Params `limit` (1-100, default 20), `offset`. `{ "items": [Set without items/conversation/changes, plus "tracks": 16 and "covers": [album art URL]], "total": 3, "limit": 20, "offset": 0 }`, newest change first. `covers` has the album art of the first 4 tracks that have one.

#### `GET /api/sets/:id/cover`

The set's cover as a 640 x 640 `image/jpeg`, drawn on the server from the title and the album art of up to 8 distinct albums in set order (fetched from Spotify's image CDN, outside the Web API quota). With fewer than 2 album covers that load, it is drawn as rings in the set's colours, without the network. A title with characters the bundled fonts cannot draw (Latin and Arabic are covered; CJK, Thai and others are not) is left off the image. The image is drawn on the first request after anything it depends on changes (title, album art) and stored. Requested with the current `v` from `coverUrl`, it is cached for good (`Cache-Control: private, max-age=31536000, immutable`); otherwise `no-cache` with an `ETag` (`304` on `If-None-Match`). A cover drawn while some album art failed to load is not cached for good and is redrawn after an hour. `404 not_found` for an unknown set or a set without tracks.

#### `POST /api/sets/:id/playlist`

Saves the set to a private Spotify playlist: created on the first save, then renamed and its items replaced in place, and uploads the set's cover as the playlist image. `200 { "playlistId": "...", "playlistUrl": "...", "tracks": 16, "cover": { "status": "uploaded" } }`. Does not start playback.

`cover.status`: `uploaded`; `unchanged` (the playlist already has this cover, so nothing was sent); `missing_scope` (the Spotify grant lacks `ugc-image-upload`; connect Spotify again); `failed` (drawing or uploading failed; the save itself stands and the next save tries again). The upload is `PUT /playlists/{id}/images` through the paced Web API queue, JPEG quality stepped down from 92 until the base64 body is at most 256 KB.

#### `POST /api/sets/:id/play`

Body `{ "deviceId"? }` or no body. Starts a DJ session with the set's tracks in order (replacing any active session) and links it to the set. `200 { "session": Session }` (see DJ session). `409 set_empty`, `409 no_active_device`, `403 premium_required`.

#### `PATCH /api/sets/:id/items/:position`

`{ "pinned": true }`. Pins or unpins one track. `200 Set`. Does not change `version`. `404 not_found` for an unknown set or position.

#### `DELETE /api/sets/:id/items/:position`

Removes one track and renumbers the rest. `200 Set` with `version` + 1 and a `changes` entry with `source: "owner"`, so a saved playlist becomes `outdated`. `404 not_found` for an unknown set or position.

#### `DELETE /api/sets/:id`

`{ "deleted": true }`. The Spotify playlist, if any, is left in the owner's account.

### Weekly picks

Each week (Monday-based, local time) Claude picks `PICKS_PER_WEEK` songs the owner has never played, `PICKS_FAR_OUT` of them further from their taste. Generated automatically at `PICKS_WEEKDAY`/`PICKS_HOUR` local time, or on demand.

Pick shape:

```json
{
  "id": 7, "week": "2026-11-09", "position": 1, "uri": "spotify:track:...", "songKey": "no love|lyves",
  "name": "No Love", "artist": "Lyves", "album": "...", "releaseDate": "2016-05-20",
  "albumArtUrl": "https://i.scdn.co/image/...", "artistImageUrl": null,
  "reason": "Sampled on WHEN SPARKS FLY, which you finished 38 times.",
  "source": { "url": "https://www.whosampled.com/...", "title": "..." },
  "distance": "near", "state": "new", "stateAt": "...",
  "outcome": { "plays": 2, "finished": 2, "playDays": 2, "inLibrary": true, "firstPlayedAt": "...", "hit": true }
}
```

- `distance`: `near` or `far`.
- `source`: the web search result from the run that supports the reason. A pick is stored only when its source was returned by that run's search and names the song or its artist. `null` only on picks made before this field existed.
- `state`: `new`, `saved`, `not_now`, `never`. `never` blocks the song from all future suggestions (sets and picks); a second `never` for the same artist blocks the artist. Moving a pick out of `never` lifts those blocks. `not_now` songs may be picked again after 28 days.
- `outcome.hit`: finished at least once and (played on 2+ days, or in the Spotify library, or state `saved`). Plays are refreshed hourly, library state daily.

#### `GET /api/picks`

Param `week` (`YYYY-MM-DD`, the Monday; default this week). `{ "week": "2026-11-09", "picks": [Pick], "stats": { "settled": 10, "played": 6, "hits": 3, "hitRate": 0.3 }, "playlist": { "playlistId": "...", "url": "..." } | null }`. `stats` covers picks older than 7 days. `playlist` is the Weekly picks living playlist (see Living playlists) while it exists in Spotify, else `null`.

#### `GET /api/picks/weeks`

Param `limit` (1-104, default 12). `{ "items": [{ "week": "2026-11-09", "picks": 5, "played": 2 }] }`.

#### `POST /api/picks/generate`

Generates this week's picks now. `201 { "week", "picks": [Pick], "stats" }`. `409 picks_exist` if this week already has picks.

#### `PATCH /api/picks/:id`

`{ "state": "saved" | "not_now" | "never" | "new" }`. `200 Pick`. When Weekly picks is on, it is refreshed afterwards (no call when its contents stay the same).

### Blocks

#### `GET /api/blocks`

`{ "items": [{ "id": 1, "kind": "song" | "artist", "key": "no love|lyves", "label": "No Love - Lyves", "reason": "never on weekly pick 2026-11-09", "createdAt": "..." }] }`

#### `DELETE /api/blocks/:id`

`{ "deleted": true }`.

### Ask

Natural-language questions about the listening history. Claude answers from read-only analytics tools and cites the numbers it used. Answers are plain text (short paragraphs, numbers inline, no markdown; any markdown the model adds is stripped), suitable for a panel or a chat message, and end with a "Based on:" line. The tools follow the Metric definitions: skips and skip rates come from export and live rows, and API rows count as listens with no skip, device or country data.

#### `POST /api/ask`

`{ "question": "Why did I stop playing Joji?", "threadId": 3 }` (`threadId` optional, continues a thread). `200 { "threadId": 3, "answer": "...", "toolCalls": [{ "name": "artist_history", "input": { "artist": "Joji" } }] }`.

#### `GET /api/ask/threads`

Param `limit` (1-100, default 20). `{ "items": [{ "id": 3, "title": "Why did I stop playing Joji?", "createdAt": "...", "updatedAt": "..." }] }`.

#### `GET /api/ask/threads/:id`

`{ "id": 3, "createdAt": "...", "updatedAt": "...", "turns": [{ "role": "owner" | "assistant", "text": "..." }] }`.

#### `DELETE /api/ask/threads/:id`

`{ "deleted": true }`.

### Liner notes

A short note per song (samples, place in the artist's career, how it fits the owner's listening). Written once and cached forever.

#### `GET /api/notes?songKey=...`

The cached note, or `404` if none yet. Never calls Claude.

#### `POST /api/notes`

`{ "songKey": "woods|mac miller" }` or `{ "uri": "spotify:track:..." }`. Returns the cached note or writes one (about 18 s, measured).

```json
{ "songKey": "woods|mac miller", "uri": "spotify:track:...", "name": "Woods", "artist": "Mac Miller",
  "albumArtUrl": "https://i.scdn.co/image/...", "artistImageUrl": "https://i.scdn.co/image/...",
  "text": "...", "sources": [{ "url": "https://...", "title": "..." }], "model": "claude-opus-5-5",
  "createdAt": "...", "cached": false }
```

### Digests

Recaps of a week, a month or a year, each a page of sections built from numbers computed in code (`src/digest/facts.ts`); Claude only writes the words around them. Kinds: `weekly` (the 7 local days ending the day before `DIGEST_WEEKDAY`; `periodKey` is the last day), `monthly` (a calendar month, `YYYY-MM`) and `yearly` (a calendar year, `YYYY`; the current year can be recapped while it runs, up to yesterday). Each period is compared with the same stretch of the period before (the week before, the month before, the year before up to the same day) when the history covers all of that stretch; otherwise there is no comparison and the page says so once. Generated by the `digest` job at `DIGEST_WEEKDAY`/`DIGEST_HOUR` local time (weekly), on the 1st at `DIGEST_HOUR` (monthly) and on 1 January at `DIGEST_HOUR` (the year before), or on demand. One recap per kind and period.

Claude returns structured output (`output_config.format`, a JSON schema): `{ "headline": "...", "takes": [{ "section": "listening", "text": "..." }] }`. Its lines carry no digits: a reply with digits is sent back once, then any line that still has one is dropped and the page shows the numbers alone there. Without Claude (no API key, or the monthly cap spent) the recap is stored with the numbers alone (`model: "code"`, `lines: null`), and a later `generate` adds the words.

#### `GET /api/digests`

Params `kind` (`weekly` | `monthly` | `yearly`, optional), `limit` (1-100, default 20). `{ "items": [{ "id": 1, "kind": "monthly", "periodKey": "2026-10", "from": "2026-10-01", "to": "2026-10-31", "label": "October 2026", "title": "Your month, October 2026", "headline": "...", "inProgress": false, "createdAt": "..." }] }`. `label` is the period's name ("7 – 13 Nov 2026", "October 2026", "2026"); `title` is "Your week, …", "Your month, …", "Your year, …" or "Your year so far, …"; `headline` is Claude's headline, else the first line of the text.

#### `GET /api/digests/:id`

The list item plus `text` (plain text for a chat message, dates written out), `facts`, `lines` (`{ headline, takes: { [section]: text } }` or `null`), `model`, `page` and `rendered` (`title`, a blank line, then `text`).

`page` is what the recap page draws:

```json
{ "kind": "monthly", "key": "2026-10", "label": "October 2026", "span": { "from": "2026-10-01", "to": "2026-10-31" }, "inProgress": false,
  "headline": "...", "headlineBy": "claude" | "facts" | "text",
  "compare": { "label": "September 2026", "from": "2026-09-01", "to": "2026-09-30", "scaled": false } | null,
  "note": "Your history starts 24 Nov 2024, so there is nothing earlier to compare with." | null,
  "quiet": false, "legacyText": null,
  "sections": [
    { "id": "listening", "take": "...", "hours": 36.4, "before": 40.1, "listens": 592, "listensBefore": 650, "artists": 399, "songs": 854, "daily": [1.2, 0.8] },
    { "id": "months", "take": null, "months": [{ "month": "2026-01", "hours": 30.2, "artist": "Mac Miller", "imageUrl": "https://i.scdn.co/...", "song": { "name": "Woods", "artist": "Mac Miller" } }] },
    { "id": "artists", "take": "...", "top": [{ "artist": "Mac Miller", "imageUrl": "...", "hours": 5.7, "share": 0.16, "before": 14.3 }], "up": [{ "artist": "...", "imageUrl": null, "hours": 4.1, "before": 2.7 }], "down": [] },
    { "id": "songs", "take": null, "songs": [{ "songKey": "...", "uri": "spotify:track:...", "name": "Loser", "artist": "3 Doors Down", "albumArtUrl": "...", "listens": 8, "hours": 0.5 }] },
    { "id": "taste", "take": "...", "genres": [{ "value": "rock", "share": 0.339, "before": 0.13 }], "moods": [] },
    { "id": "finds", "take": null, "songs": { "count": 4, "ofNew": 166, "top": [{ "songKey": "...", "uri": "...", "name": "...", "artist": "...", "albumArtUrl": null, "listens": 8 }] }, "artists": { "count": 2, "ofNew": 60, "top": [{ "artist": "...", "imageUrl": null, "listens": 4 }] } },
    { "id": "rhythm", "take": null, "day": { "day": "2026-10-22", "hours": 3.4 }, "hour": { "hour": 8, "hours": 6.3 }, "byHour": [0, 0.2] }
  ] }
```

- Sections appear only when the numbers support them, in the order above: `listening` always; `months` for a year with two or more months of listening; `artists`, `songs` (the period's playlist: most listens, then most time, at least 2 listens, at most 15, 25 or 50 songs for a week, month or year; skips never lower a song), `taste` (only with a comparison, tags whose share moved 5 points or more), `finds` (songs and artists first played in the period and listened to again on another day of it; needs earlier history), `rhythm` (busiest day and hour). `quiet: true` (fewer than 5 listens or under half an hour) keeps only `listening`.
- `before` values are the compared period's. `share` values are 0 to 1. `byHour` is hours per local hour 0-23; `daily` hours per day of the period.
- Recaps stored before recaps were pages (`facts` without `version: 2`) open with the same sections from their stored numbers: `headlineBy: "text"`, `compare.scaled: true` (their comparison was a typical period, scaled), `daily` and `byHour` null, and `legacyText` holds the text Claude wrote then, ISO dates written out.

#### `GET /api/digests/periods/:kind/:key`

One period on the timeline. `{ "kind", "key", "label", "from", "to", "inProgress", "available", "reason": null | "before_history" | "not_ended", "previous": "2026-09" | null, "next": "2026-11" | null, "historyStart": "2024-11-24", "recap": <GET /api/digests/:id body without rendered> | null, "playlist": { "songs": 25, "canSave": true, "saved": { "url": "https://open.spotify.com/playlist/...", "savedAt": "...", "source": "recap" | "living" } | null, "coverUrl": "/api/digests/periods/monthly/2026-10/cover?v=..." | null } | null }`. `playlist` describes the period's songs as a Spotify playlist (the `songs` section rule); `null` before the history or before the period starts. `canSave` is false while the period is still going (the current year lives in Spotify as the This year so far living playlist instead) and when no song was listened to twice; `coverUrl` is null then too. `from`/`to` are what the period covers today. `previous` is null before the history starts, `next` once the next period has not started covering. `available: false` means `generate` would refuse this period. An invalid key is `404`.

#### `GET /api/digests/:id/card`

The recap's share card as a PNG download (`Content-Disposition: attachment; filename="encore-october-2026.png"`). Param `format`: `wide` (1200 x 630, default) or `square` (1080 x 1080, filename ends `-square`). The encore mark, the period, the headline and two or three figures (hours, the change against the compared period, songs) on ink, beside or above a dithered field drawn from the period's art. A headline with characters the bundled fonts cannot draw is replaced by "<hours> of music". Drawn on request; the art comes from Spotify's image CDN, no Web API call.

#### `GET /api/digests/periods/:kind/:key/cover`

The cover JPEG the period's playlist gets in Spotify: the period's name ("October 2026") over the album art of its songs, in the dithered `field` style. Drawn on first request from Spotify's image CDN (no Web API call) and kept in memory. Cached for good at the versioned `coverUrl`. `404` when the period has no songs, `409 period_unavailable` while it is still going.

#### `POST /api/digests/periods/:kind/:key/playlist`

Saves the period's songs as a private playlist in the owner's account, only on the owner's tap: named after the period ("October 2026"), described "The songs that defined October 2026, from your encore recap.", with the cover above. The first save makes the playlist (3 calls: create, items, cover); saving again updates the same playlist in place (2 calls, the cover only when it changed), or makes a new one when it was deleted in Spotify. Library cleanup never proposes changes to these playlists. `{ "playlistId", "playlistUrl", "tracks": 25, "cover": { "status": "uploaded" | "unchanged" | "missing_scope" | "failed" } }`. `409 period_unavailable` (still going), `409 playlist_empty` (no song listened to twice), `409 spotify_not_connected`, `409 missing_scope`.

#### `GET /api/digests/latest/:kind`

`{ "kind": "weekly", "key": "2026-11-12" }`: the newest period that has ended (the current year for `yearly`).

#### `POST /api/digests/generate`

`{ "kind": "weekly" | "monthly" | "yearly", "key"?: "2026-10" }`. Without `key`, the newest period that has ended (the current year for `yearly`). Returns the recap (same shape as `GET /api/digests/:id` without `rendered`, plus `created`). A stored recap is returned as is (`created: false`, no Claude call), except that one without Claude's lines gets them when Claude is available, and the current year is brought up to yesterday. With `Accept: text/event-stream` it runs as a run (see Runs) keyed `/api/digests/generate`; send that only when Claude is available, since a stream requires it. `409 period_unavailable` for a period that has not ended or that the history does not reach.

### Spend

#### `GET /api/llm/spend`

Params `month` (`YYYY-MM`, default current local month), `limit` (1-500, default 50).

```json
{
  "month": "2026-11",
  "byFeature": [{ "feature": "picks", "calls": 6, "usd": 0.6399, "inputTokens": 21000, "outputTokens": 9000, "cacheReadTokens": 160000, "cacheWriteTokens": 30000, "webSearches": 12 }],
  "recent": [{ "id": 12, "ts": "...", "feature": "picks", "ref": "week:2026-11-09", "requestedModel": "claude-opus-5-5", "model": "claude-opus-5-5",
               "inputTokens": 3000, "outputTokens": 1500, "cacheReadTokens": 30000, "cacheWriteTokens": 0, "webSearches": 3,
               "usd": 0.072, "stopReason": "tool_use", "durationMs": 21000 }],
  "budget": { "month": "2026-11", "spentUsd": 1.18, "capUsd": 100, "remainingUsd": 98.82, "exhausted": false },
  "model": "claude-opus-5-5",
  "pricesPerMTok": { "claude-opus-5-5": { "input": 4, "output": 20, "cacheWrite5m": 5, "cacheWrite1h": 8, "cacheRead": 0.2 } },
  "webSearchPerRequest": 0.01
}
```

`model` in `recent` differs from `requestedModel` when the API fell back to another model.

### Chat integrations

Not HTTP: plain functions in `src/assistant/api.ts` for a chat bot running in the same process (the Discord commands use them). They take `services.assistant` (the `FeatureContext` the routes use) and throw the same typed errors.

| Function | Returns |
| --- | --- |
| `createSetFromText(ctx, text)` | `{ id, title, description, tracks, newTracks, lines: ["1. Woods - Mac Miller: reason"], reply }` |
| `currentPicks(ctx, { generate? })` | Same body as `GET /api/picks` without `playlist`; generates this week's picks first when `generate` is set and none exist |
| `updatePickState(ctx, pickId, state)` | Pick (blocks applied as for `PATCH /api/picks/:id`) |
| `savePick(ctx, pickId)` | Pick, after state `saved` and `PUT /me/library` for its URI |
| `setForChat(ctx, setId)` | Set (as `GET /api/sets/:id`) plus `dashboardUrl` |
| `saveSetToSpotify(ctx, setId)` | Same body as `POST /api/sets/:id/playlist` |
| `playSetNow(ctx, dj, setId)` | DJ session (as `POST /api/sets/:id/play`) |
| `askText(ctx, question, threadId?)` | `{ threadId, text }` |
| `latestDigest(db, kind?)` | Same body as `GET /api/digests/:id`, or `null` |

