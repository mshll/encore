# encore HTTP API

Contract between the server and the web UI. All routes are JSON over HTTP on the same origin as the UI.

## Conventions

- Base path `/api`. Only exception: `GET /callback` (Spotify OAuth redirect).
- Auth: every `/api/*` route needs a session cookie, except `/api/health`, `/api/auth/*` and `/api/discord/interactions` (Discord signature instead). `/api/tags/*` also accepts `Authorization: Bearer <ADMIN_TOKEN>`. The admin token is rejected everywhere else. `/mcp` takes only `Authorization: Bearer <MCP_TOKEN>`.
- Session cookie: `encore_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, 30 days, `Secure` when `PUBLIC_BASE_URL` is https. Send requests with `credentials: "same-origin"` (the default for same-origin `fetch`).
- Errors: non-2xx responses have this body:

  ```json
  { "error": { "code": "invalid_request", "message": "Request validation failed", "details": [{ "path": "from", "message": "expected YYYY-MM-DD" }] } }
  ```

  `details` is present only on some errors. Status codes: `400` validation, `401` not signed in, `403` setup token wrong or `premium_required`, `404` not found, `409` precondition (`spotify_not_connected`, `no_active_device`), `413` file too large, `415` wrong content type, `500` server error, `502` Spotify call failed (`spotify_failed`), `503` Spotify calls paused (`spotify_paused`, `details: { reason, until }`).
- Timestamps (`ts`, `firstPlayed`, `lastPlayed`, `start`, `end`, ...) are ISO 8601 UTC strings.
- Days, hours, weekdays, weeks, months are local time in `TIMEZONE` (default Asia/Kuwait). `day` is `YYYY-MM-DD`. `weekday` is ISO: 1 = Monday ... 7 = Sunday.
- `hours` values are rounded to 2 decimals. Rates (`skipRate`, `shuffleRate`, `share`) are 0..1 rounded to 3 decimals, or `null` when the denominator is 0.

### Common query parameters

| Param | Format | Meaning |
| --- | --- | --- |
| `from`, `to` | `YYYY-MM-DD` | Inclusive local-day range. Both optional (open-ended). `from > to` is a 400. |
| `period` | `day` \| `week` \| `month` \| `year` | Bucket size. Default `month`. `week` labels are the Monday date (`YYYY-MM-DD`), `month` is `YYYY-MM`, `year` is `YYYY`. |
| `limit`, `offset` | integers | Paging. Limits are per endpoint. |

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
  - `dayType`: `weekend` = Friday or Saturday (Kuwait weekend), else `weekday`.
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
- **Trip**: plays ordered by time, ignoring rows without `conn_country` (all API rows). A trip is a maximal run of consecutive plays whose country is not `HOME_COUNTRY` (default `KW`); a single home-country play ends it. A trip can span several countries. Trips with fewer than `minPlays` plays (default 5) are dropped. `days` counts local days from first to last play inclusive. Trip plays count all kinds (country is about location); `hours` and `topTracks` count music only.
- **Forgotten**: songs with at least `minListens` listens (all time) and no play of any kind in the last `days` days.
- **Export vs API and live**: export rows are the source of truth. Importing an export deletes API and live rows from the export's first to last timestamp (plus 999 ms, since export timestamps have second precision), and the poller and the watcher ignore plays at or before the newest export row (+999 ms). `apiPlaysRemoved` counts both.
- **Live plays** (`source: "live"`): the `watch` job polls `GET /me/player` and turns state changes into plays. `ms_played` is the progress it observed (pauses excluded, forward seeks capped at wall time). `skipped` is true when the track changed before 90% of its duration; stopping playback is not a skip. `reason_end` is `trackdone` (reached the last 5 s), `fwdbtn` (changed earlier) or `endplay` (playback stopped); `reason_start` is the previous play's `trackdone`/`fwdbtn`, else `null`. All three are inferred, not Spotify's values. A gap between polls over `2 x WATCHER_IDLE_SECONDS + 30 s` leaves the end unknown (`skipped`, `reason_end` null). `device` comes from the Spotify device name and type; `contextUri` is the playlist or album played from. A watcher that starts mid-track counts the part before its first poll as played.
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
  "timezone": "Asia/Kuwait",
  "spotify": {
    "connected": true,
    "userId": "abc123",
    "scopes": ["user-read-recently-played", "..."],
    "missingScopes": ["user-read-playback-state"],
    "paused": null
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
  "plays": { "plays": 39821, "music": 39338, "api": 10 },
  "live": { "watch": { "lastRunAt": "...", "...": "same shape as poll" }, "radar": { "...": "..." }, "library": { "...": "..." } },
  "integrations": { "discord": false, "mcp": true }
}
```

- `timezone`: the `TIMEZONE` used for every local day, hour and weekday. Format `ts` values in it to match the buckets.
- `spotify.paused` is `null` or `{ "reason": "rate_limited" | "quota_exceeded", "until": "...", "since": "..." }`. While paused, the server makes no Spotify calls. `quota_exceeded` means the developer-account quota was hit; the pause lasts `QUOTA_BACKOFF_HOURS` (default 12) and the UI should show it.
- `missingScopes`: scopes the server asks for that the stored grant lacks. Reconnect to grant them.
- `poll.lastResult` also has `skippedCoveredByLive` (API plays the watcher already stored). It may be `{ "skipped": "spotify_not_connected" }`. `lastRunAt`/`lastSuccessAt` are `null` before the first run. `import` is `null` before the first import.
- `enrichment.failed`: tracks given up on after 3 failed lookups. `withArt`: tracks with an `albumArtUrl`.
- Enrichment makes one Web API call per run (`ENRICH_INTERVAL_SECONDS`, default 4): `GET /tracks/{id}` (metadata, 640 px art, artist ids) or `GET /artists/{id}` (image), whichever pending item has more listens. `enrichment.art` is the oEmbed job (`ART_INTERVAL_SECONDS`, default 4). Both stop while `spotify.paused` is set.
- `integrations`: whether the Discord endpoint (`DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_OWNER_ID`) and `/mcp` (`MCP_TOKEN`) are configured.
- `enrichment.artists`: artists learned from enriched or polled tracks; `fetched` had their `GET /artists/{id}` lookup.

## Auth (passkeys)

Use `@simplewebauthn/browser` on the client: pass the options JSON to `startRegistration({ optionsJSON })` / `startAuthentication({ optionsJSON })` and send the result back as `response`. Passkeys are discoverable (no username). The server keeps challenges in memory for 5 minutes; each is single-use.

### `GET /api/auth/session` (public)

`{ "authenticated": false, "setupRequired": true }`. `setupRequired` is true while no passkey exists.

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

## Spotify

### `GET /api/spotify/authorize`

`{ "url": "https://accounts.spotify.com/authorize?..." }`. Navigate the browser to `url` (full page, not fetch). PKCE, state valid 10 minutes.

### `GET /callback` (public, Spotify redirects here)

Exchanges the code and redirects (302) to `PUBLIC_BASE_URL/?spotify=connected`, `?spotify=error` (bad state or token exchange failed), or `?spotify=denied` (owner declined).

### `POST /api/spotify/disconnect`

Deletes stored tokens. `{ "connected": false }`. A revoked refresh token also disconnects automatically.

### `POST /api/spotify/poll`

Runs the recently-played poll now. `200 { "received": 50, "inserted": 3, "skippedCoveredByExport": 0 }`. `409 spotify_not_connected`; `502 poll_failed` with the reason in `message` (for example a pause).

## Import

### `POST /api/import`

`multipart/form-data`, field `files` repeated once per file. Accepts `Streaming_History_Audio_*.json` and `Streaming_History_Video_*.json`; other files are listed in `ignoredFiles`. Max 30 files, 50 MB each. Runs synchronously (about 1-2 s for the full export).

```json
{
  "files": [{ "name": "Streaming_History_Audio_2025.json", "kind": "audio", "rows": 12000, "invalid": 0 }],
  "ignoredFiles": ["ReadMeFirst_ExtendedStreamingHistory.pdf"],
  "rowsParsed": 39811,
  "invalidRows": 0,
  "inserted": 39811,
  "alreadyPresent": 0,
  "apiPlaysRemoved": 0,
  "range": { "from": "2021-05-16T06:56:32.000Z", "to": "2026-11-12T21:31:26.000Z" }
}
```

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

Params: `limit` (1-200, default 50), `offset` (default 0), `sort` = `hours` (default) | `listens` | `plays`. `top/artists` and `top/tracks` also take `weekday` (1-7) and `hour` (0-23) to count only plays in that local weekday and/or hour (one `clock` cell).

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
  "neverSkipped": [Song]
}
```

`mostSkipped*` sort by skip rate, then volume. `quickSkips` sorts by quick-skip count. `neverSkipped` is songs with 0 skips, sorted by plays.

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
{ "homeCountry": "KW",
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

Seam: `DjService.setReplanner(fn)` with `fn(input: { finished, skipped, current, upcoming, exclude, now }) => Promise<string[]>` (track URIs). Returned URIs that are played, current or invalid are dropped.

### `POST /api/dj/start`

Body `{ "uris": [track URI] (1-500), "deviceId"? }`. Replaces any active session. `400 invalid_set`, `409 no_active_device`.

```json
{ "session": { "id": 3, "status": "active", "playlistUri": "spotify:playlist:...", "position": 0, "current": "spotify:track:...",
  "upcoming": ["spotify:track:..."], "played": [{ "uri": "spotify:track:...", "outcome": "skipped" }],
  "skipStreak": 0, "replans": 0, "startedAt": "...", "endedAt": null, "endReason": null } }
```

### `GET /api/dj`

`{ "session": Session | null }`: the active session, else the latest one. `status` is `active`, `stopped` or `ended`; `endReason` is `stopped`, `replaced` or `left_playlist`.

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

## Cleanup

Proposals only; nothing is removed until the owner applies a selected batch here. The `library` job syncs saved songs (`GET /me/tracks`) and the items of playlists the owner owns (`GET /me/playlists`, then `GET /playlists/{id}/items` for playlists whose snapshot changed), one page call every `LIBRARY_PAGE_SECONDS` (20), a full pass every `LIBRARY_SYNC_HOURS` (24). The cursor is stored, so a restart resumes the pass. App-owned playlists are skipped. Proposals are rebuilt after each pass; dismissed and applied ones keep their status.

Kinds (stats are all-time over the song, merged by `songKey`):

- `saved_never_played`: saved more than 30 days ago, no play of the song.
- `saved_dislike`: saved song classed `dislike` by the skip split (8+ plays with a known skip flag).
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
                            "lastPlayed": "...", "savedAt": "...", "class": "dislike" } }] }
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

No gateway connection. Set `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` and `DISCORD_OWNER_ID` to enable the endpoint; point the Discord application's Interactions Endpoint URL at `PUBLIC_BASE_URL/api/discord/interactions`.

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

Button custom ids are `prefix:arg`; built in: `queue:<track URI>`.

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
