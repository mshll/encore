# encore HTTP API

Contract between the server and the web UI. All routes are JSON over HTTP on the same origin as the UI.

## Conventions

- Base path `/api`. Only exception: `GET /callback` (Spotify OAuth redirect).
- Auth: every `/api/*` route needs a session cookie, except `/api/health` and `/api/auth/*`. `/api/tags/*` also accepts `Authorization: Bearer <ADMIN_TOKEN>`. The admin token is rejected everywhere else.
- Session cookie: `encore_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, 30 days, `Secure` when `PUBLIC_BASE_URL` is https. Send requests with `credentials: "same-origin"` (the default for same-origin `fetch`).
- Errors: non-2xx responses have this body:

  ```json
  { "error": { "code": "invalid_request", "message": "Request validation failed", "details": [{ "path": "from", "message": "expected YYYY-MM-DD" }] } }
  ```

  `details` is present only on some errors. Status codes: `400` validation, `401` not signed in, `403` setup token wrong, `404` not found, `409` precondition (Spotify not connected), `413` file too large, `415` wrong content type, `500` server error, `502` Spotify call failed.
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
- **Listen**: a music play with `ms_played >= 30000` (export rows) or any API row. The Spotify recently-played API only reports plays it counted, and it does not give `ms_played`.
- **Hours**: sum of `ms_played`. API rows have no `ms_played`, so they count the track's full `duration_ms` once known (from the poll itself or enrichment), else 0.
- **Skip**: Spotify's own `skipped` flag on export rows. API rows have no skip data (`skipped: null`) and are left out of every skip rate denominator. `skipRate = skips / plays with known skip flag`.
- **Quick skip**: a skip with `ms_played < 5000`.
- **Shuffle rate**: plays with `shuffle = true` / plays with a known shuffle flag.
- **Song (merged track)**: plays are grouped by `songKey`, not URI. `songKey = normalizedTitle + "|" + normalizedArtist`, where normalization lowercases, strips accents, removes `(feat. ...)`, `(with ...)`, `[ft. ...]`, trailing `feat. ...`, and remaster markers (`- Remastered 2011`, `(Remastered)`), then collapses all punctuation to single spaces. Live versions and other edits stay separate. Artist is the export's `master_metadata_album_artist_name` (Spotify's primary artist for the track) or, for API-only tracks, the first listed artist. Song rows show the name, album, and URI of the song's most-played URI.
- **Artist**: grouped by artist name string. **Album**: grouped by (artist, album name).
- **Context dimensions** (used by the skip split and skip profiles). Only export rows with a known skip flag:
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
- **Export vs API**: export rows are the source of truth. Importing an export deletes API rows from the export's first to last timestamp (plus 999 ms, since export timestamps have second precision), and the poller ignores API plays at or before the newest export row (+999 ms).

### Enums

- `device`: `ios`, `android`, `mac`, `windows`, `linux`, `web`, `console`, `tv`, `speaker`, `car`, `unknown`, `other`. Derived from the export `platform` string (raw value kept server-side). API rows are always `unknown`: recently-played has no device field.
- `kind`: `track`, `episode`, `audiobook`, `video`.
- `source`: `export`, `api`.

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

`albumArtUrl` is `null` until the track is enriched.

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
  "spotify": {
    "connected": true,
    "userId": "abc123",
    "scopes": ["user-read-recently-played", "..."],
    "missingScopes": ["user-read-playback-state"],
    "paused": null
  },
  "poll": { "lastRunAt": "...", "lastSuccessAt": "...", "lastError": null,
            "lastResult": { "received": 50, "inserted": 2, "skippedCoveredByExport": 0 } },
  "enrichment": { "total": 5472, "enriched": 14, "failed": 0, "lastRunAt": "...", "lastSuccessAt": "...", "lastError": null,
                  "lastResult": { "attempted": 3, "enriched": 3, "failed": 0 } },
  "import": { "lastImportAt": "...", "result": { "...": "ImportResult, see POST /api/import" } },
  "tags": { "songs": 5055, "tagged": 0, "coverage": 0 },
  "plays": { "plays": 39821, "music": 39338, "api": 10 }
}
```

- `spotify.paused` is `null` or `{ "reason": "rate_limited" | "quota_exceeded", "until": "...", "since": "..." }`. While paused, the server makes no Spotify calls. `quota_exceeded` means the developer-account quota was hit; the pause lasts `QUOTA_BACKOFF_HOURS` (default 12) and the UI should show it.
- `missingScopes`: scopes the server asks for that the stored grant lacks. Reconnect to grant them.
- `poll.lastResult` may be `{ "skipped": "spotify_not_connected" }`. `lastRunAt`/`lastSuccessAt` are `null` before the first run. `import` is `null` before the first import.
- `enrichment.failed`: tracks given up on after 3 failed lookups.

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
  "topArtist": { "artist": "Mac Miller", "hours": 118.48, "listens": 1889 },
  "topTrack": { "songKey": "glimpse of us|joji", "uri": "spotify:track:3aBGKDiAAvH2H7HLOyQ4US", "name": "Glimpse of Us", "artist": "Joji", "hours": 9.6, "listens": 137 }
}
```

`uniqueTracks` counts songs (merged). `topArtist`/`topTrack` are by hours and are `null` for an empty range.

### `GET /api/stats/timeseries`

Params: `period`. Only buckets with plays are returned (fill gaps on the client).

`{ "period": "month", "points": [{ "period": "2026-01", "hours": 62.1, "plays": 1650, "listens": 980 }] }`

### `GET /api/stats/top/artists` | `/top/tracks` | `/top/albums`

Params: `limit` (1-200, default 50), `offset` (default 0), `sort` = `hours` (default) | `listens` | `plays`.

- artists: `{ "items": [{ "artist": "Mac Miller", "songs": 120, ...Stats }] }`
- tracks: `{ "items": [Song] }`
- albums: `{ "items": [{ "album": "Circles", "artist": "Mac Miller", "albumArtUrl": "...", "songs": 14, ...Stats }] }`

### `GET /api/stats/eras`

Params: `limit` (1-30, default 10) top artists by hours. Stacked-chart ready: `series[i].hours[j]` is the hours of that artist in `months[j]`.

```json
{
  "months": ["2026-10", "2026-11"],
  "series": [{ "artist": "Mac Miller", "hours": [5.68, 0.61] }],
  "artists": [{ "artist": "Mac Miller", "hours": 6.29, "firstPlayed": "...", "lastPlayed": "...", "peakMonth": "2026-10", "peakMonthHours": 5.68 }]
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
  "mostSkippedArtists": [{ "artist": "CeeLo Green", ...Stats }],
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

`songs` is sorted by plays. `bestContext`/`worstContext` are `null` when no context reaches `minContextPlays`. The split uses export rows only, so `plays` here counts plays with a known skip flag. `params` are the exact thresholds used (unrounded in the response).

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
    "topTracks": [{ "songKey": "piano man|billy joel", "uri": "spotify:track:...", "name": "Piano Man", "artist": "Billy Joel", "plays": 2, "listens": 2, "hours": 0.19 }]
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
{ "artist": "Mac Miller", "totals": Stats,
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
{ "artists": [{ "artist": "Mac Miller", ...Stats }],
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
