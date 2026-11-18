# Share links

encore is single-user and every page sits behind a passkey session. A share link is the one exception: a public,
read-only copy of one recap or one Ask answer that anyone holding the link can open. This page is the security model. The HTTP contract
is in [api.md](api.md#shares).

## What a link is

- Made only by the owner, from the recap page or from an answer in the chat panel (`POST /api/shares`). Nothing makes links on its own: no job, no Discord
  command, no default.
- A frozen snapshot. The recap page, or the answer and the question before it, is copied into the `shares` row when
  the link is made, field by field (see below).
  The public routes read that row and nothing else: no query touches plays, tracks, settings, the recap row or any
  other table. Importing, deleting or re-tagging plays, writing the recap again or deleting it, or deleting the Ask
  thread never changes a shared page. A share of today's year so far stays as it was on the day it was made.
- The token is 32 bytes from the CSPRNG (`crypto.randomBytes`), base64url: 43 characters, 256 bits. Only its SHA-256
  is stored (`shares.token_hash`, unique). The full URL is in the response that made it and nowhere else: not in the
  database, not in logs, not in the owner's list. A lost link cannot be shown again; make a new one.
- Optional expiry (1 to 365 days). Revocable at any time (`DELETE /api/shares/:id`); revoking is permanent.
- The owner's list shows each link's creation date, expiry, view count and last view. A view is a `GET` of the page;
  the card and the snapshot do not count. No visitor data is stored: no IP, no user agent, no referrer.

## What a stranger can reach

Only three routes, all under `/s/:token`, all without a session:

| Route | Answers |
| --- | --- |
| `GET /s/:token` | The page: server-rendered HTML, no script |
| `GET /s/:token/card.png` | The 1200 x 630 share card (recap or answer), for link previews |
| `GET /s/:token/snapshot.json` | The snapshot the page is drawn from |

A token that is malformed, unknown, revoked or expired gets one and the same `404` page, with no hint of which. The
lookup is by hash, so there is nothing to compare character by character. Any other address under `/s` gets the same
`404` page, never the app.

The routes never read the session cookie. The owner signed in sees exactly the page a stranger sees, and nothing on it
links back into the app.

## What the snapshot holds

Every field, and nothing else (`src/share/snapshot.ts` builds it field by field from the recap page):

- `version`, `kind` (`"recap"`)
- `recap.kind` (week, month or year), `recap.label` ("October 2026"), `recap.from`, `recap.to`, `recap.inProgress`
- `recap.headline`, `recap.compare.label` (the compared period's name), `recap.note` (for example "Your history starts
  24 Nov 2024..."), `recap.quiet`
- `recap.sections`, each with Claude's `take` when there is one:
  - `listening`: hours, hours before, listens, artists, songs, hours per day
  - `months`: per month the hours and the top artist with its image
  - `artists`: the top artists with image, hours, share and hours before; artists up and down
  - `songs`: name, artist, Spotify track URI (linked to open.spotify.com), album art, listens
  - `taste`: genre and mood shares, now and before
  - `years` (a year): the two years' plays, hours, artists, new artists and new songs; the top artists with image,
    their rank in each year and the change; genre and mood shares in each year
  - `finds`: counts of new songs and artists that came back, with the top few; the share of time on new songs
  - `comebacks`: artist, image, the day last played before the gap and the day back, the gap in days
  - `records`: all-time records set in the period (day, week, month, session length, the song played most in a day
    with its name, artist, Spotify track URI and art) and milestones (song or artist name, threshold, day)
  - `rhythm`: busiest day and hour, hours per hour of the day, the longest run of days with music
- `card`: the card's label, headline, a fallback headline, two or three figures, and the art URLs it is drawn from

For an answer (`src/share/snapshot.ts`, `answerSnapshot`):

- `version`, `kind` (`"answer"`)
- `question`: the owner's question right before the answer, as they typed it (without the page context or local
  time sent with it)
- `answer.blocks`: the prose, with numbers that matched no tool result marked `unchecked`, and where each visual sits
- `answer.visuals`: each visual's kind, title or label, unit and values; ranked rows name a song (name, artist,
  Spotify track URI, album art), an artist (name, image), an album (name, artist, art) or a label
- `answer.basis`: the closing "Based on" line
- `card`: the question, the answer's first sentence, the visual that leads the card and the art URLs it is drawn from

Left out of an answer on purpose: every other turn of the thread, the thread id and title, tool calls and their
results, song keys, the model, token counts and spend.

Left out of a recap on purpose: the owner's name, email, passkeys and Spotify user id; device names and platforms; countries and
any IP data; Claude's model, token counts and spend; ids of rows (recap, songs, plays) and song keys; settings and the
timezone name; skip data; the text of recaps written before recaps were pages. Images are Spotify CDN URLs only.

## Headers and policy

- `Content-Security-Policy` is the app's own: `default-src 'self'`, `script-src 'self'` (the page has no script),
  styles inline, images from `https:` and `data:`. No third-party script origin.
- `X-Robots-Tag: noindex, nofollow, noarchive` and the same `<meta name="robots">`.
- `Referrer-Policy: no-referrer`, so following a song link does not send the token anywhere.
- `Cache-Control: no-store`, so a revoked link stops answering at once, also behind a proxy.
- `og:*` and `twitter:*` tags point at the card by its absolute URL, built from `PUBLIC_BASE_URL`.

## Abuse

- 60 requests a minute per client address and 1200 a minute across all clients on `/s/*`; past either, `429`. With
  256-bit tokens, guessing is not a practical attack; the limits keep a scan from costing database reads and keep
  floods from costing work.
- The card is drawn once per link and kept in memory (the 64 most recent), so repeated card requests cost no drawing.
- The client address is used only for the in-memory rate limit window. It is never stored or logged.

## Later

The `shares.kind` column and the `/api/shares` routes take a kind so sets, playlists and top lists can be shared the
same way. Each new kind needs its own snapshot builder that lists its fields, as `recapSnapshot` and `answerSnapshot`
do. `shares.ref_index` holds a position inside `ref_id` when one id is not enough (an answer's turn).
