# encore design

The contract for every screen in `web/`. Section 1 is the information architecture; the rest is how a surface is built. When this file and a screen disagree, the screen is wrong.

## 1. Information architecture

encore answers three jobs: **what have I been listening to**, **what should I play next**, and **keep my Spotify tidy**. Every surface belongs to one job and answers one question.

### Sitemap

```
Listening                      Play                        Secondary            Foot
├── Home              /        ├── For you    /for-you     ├── Recaps  /recaps  └── Settings /settings
├── Plays             /plays   │   ├── Weekly picks  /picks   │   └── /recaps/:kind/:key ├── general
├── Music             /music   │   ├── Forgotten favourites  ├── Library /library        ├── spotify
│   ├── Artists   /artists     │   ├── Most played lately    └── Setup   /setup          ├── claude
│   ├── Albums    /albums      │   ├── New from your artists                             ├── integrations
│   ├── Songs     /songs       │   ├── This month in past years                          ├── jobs
│   │                          │   └── This year so far  (/for-you/:kind)                └── account
│   ├── Forgotten /forgotten   ├── Sets       /sets
│   │                          │   └── /sets/:id
│   ├── /music/artist/:name    └── Ask        /ask
│   ├── /music/album/:artist/:album  └── /ask/:id
│   └── /music/song/:songKey
└── Patterns          /patterns
    ├── When   /when
    ├── Eras   /eras
    ├── Taste  /taste
    ├── Skips  /skips
    └── Places /places

Shell, on every surface: sidebar (desktop) or tab bar + More sheet (phone), command palette (⌘K, G then key),
docked player bar with the queue panel (desktop) or mini player + now-playing sheet (phone).

Library /library
├── Overview      /library               the state of liked songs and playlists
│   └── Songs     /library/songs         the songs behind one figure, with Make a plan
├── Plans         /library/plans         review, Claude, applied with Undo, dismissed
│   ├── Plan      /library/plans/:id
│   └── Claude    /library/claude/:id    a conversation whose first turn was a question
└── Instructions  /library/instructions  standing instructions, kept out of picks and sets
```

The source of truth for paths, labels, icons and shortcuts is `web/src/app/nav.ts`. The desktop sidebar shows every surface in its three groups (Listening, Play, Secondary) with Settings at the foot; there is no More menu. Setup leaves the sidebar once onboarding is complete (read from `/api/onboarding`, hidden until it loads), unless it is the open page; Settings (Open setup) and the palette still reach it. Phone tabs are the four Listening surfaces plus More, a sheet with search and the Play, Secondary and Foot surfaces.

### Surfaces

| Surface | Answers | Primary action | API | Status |
| --- | --- | --- | --- | --- |
| Home `/` | How much have I listened this week, against my usual? Then: what should I play, and what is new for me? | Play what encore made (a cover, a pick) | `stats/week`, `living`, `picks`, `radar`, `digests`, `status`; then `stats/overview` (the range's totals), `stats/top/*`, `stats/on-this-day` | Built |
| Plays `/plays` | What exactly did I play, when, where? | Search and filter the log | `history` (paged, `q`, `outcome`, `device`, `source`, `artist`, `songKey`), `status`, `stats/overview` (first use) | Built |
| Music `/music/*` | Who and what do I play most, and which favourites did I drop? | Open an artist, album or song | `stats/top/*` (paged, `sort`, `q`), `stats/forgotten`, `stats/overview` (counts) | Built |
| Artist, album, song pages | Everything about one artist, album or song | Play it | `entities/artist`, `entities/album`, `entities/track`, `notes` (liner notes), `radar` (artist releases) | Built |
| Patterns: When | When in the week do I listen? | Pick a weekday and hour to see what fills it | `stats/clock`, `stats/top/tracks` and `top/artists` with `weekday` and `hour` | Built |
| Patterns: Eras | Which artists defined which months? | Pick an era | `stats/eras`, `entities/artist` and `stats/top/artists` for the picked month | Built |
| Patterns: Taste | Which genres, moods and energy over time? | Switch genres and moods | tag stats (`stats/tags/*`), `stats/timeseries`, `tags/pending` | Built |
| Patterns: Skips | How do plays end, and in what context do I skip? | Pick a moment class | `stats/skips` (with `summary.outcomes` and `profile`), `stats/skips/split` | Built |
| Patterns: Places | Where and on what do I listen (trips, devices)? | Pick a trip | `stats/trips`, `stats/devices` | Built |
| For you `/for-you` | What has encore made for me, what is in each, and is it fresh? | Play a playlist, or a song in it | `living` (each with its first songs), `picks` (this week, with reasons), `radar` (releases), `runs` (a picks run going), `digests/playlists` (From your recaps), `living/:kind` (play an off playlist) | Built |
| For you: a playlist `/for-you/:kind` | What is in this playlist, and is it in my Spotify? | Play it | `living/:kind`, `living/:kind/refresh`, `living/:kind/refreshes/:id`, `living/:kind/cover`, `living` (Spotify gate) | Built |
| Weekly picks `/for-you/picks` | What did Claude pick for me this week, and why? | Play | the playlist's routes, plus `picks`, `picks/weeks`, `picks/:id`, picks run (stream), `blocks` | Built |
| New from your artists `/for-you/new-releases` | What did artists I play release? | Play | the playlist's routes, plus `radar`, `radar/seen` | Built |
| Sets `/sets` | Make me a playlist from a prompt | Make a set | `sets`, `sets/:id`, set run (stream), `dj/start`, `dj`, `dj/stop` | Built |
| Ask `/ask` | Answer a question about my listening | Ask | `ask/threads`, `ask/threads/:id`, ask run (stream) | Built |
| Recaps `/recaps` | What changed in how I listen, and what was this week, month or year? | Write the recap of a period that has none | `digests`, `digests/periods/:kind/:key`, `digests/latest/:kind`, `digests/:id`, `digests/periods/:kind/:key/playlist`, `digests/periods/:kind/:key/cover`, `living` (This year so far), `digests/:id/card`, `shares`, recap run (stream) | Built |
| Library: Overview `/library` | What state are my liked songs and playlists in? | Open the songs behind a figure | `library/analysis` | Built |
| Library: songs `/library/songs` | Which songs are behind this figure? | Make a plan from them | `library/songs` (paged), `library/plans` (POST) | Built |
| Library: Plans `/library/plans` | What is waiting for review, what did I apply, and what should Claude tidy? | Review a plan | `library/plans`, `library/batches` (polled while one runs), `library/batches/:id/undo`, `library/plans/:id/restore`, conversation run (stream) | Built |
| Library: plan `/library/plans/:id` | What exactly would this plan change? | Apply | `library/plans/:id` (paged by status), `library/plans/:id/items`, `.../apply`, `.../dismiss`, `.../restore`, `library/batches`, `library/conversations/:id` and its run | Built |
| Library: Instructions `/library/instructions` | What does Claude plan on a schedule, and what is kept out of picks? | Add an instruction | `library/standing`, `blocks` | Built |
| Setup `/setup` | Is encore connected and fed? | Do the next missing step | `onboarding`, `spotify/authorize`, `import`, `settings` | Built |
| Settings `/settings/*` | How does encore run? | Save a change | `settings`, `settings/claude/verify`, `settings/discord/register`, `spotify/disconnect`, `spotify/poll`, `llm/spend`, `auth/logout`, passkey routes | Built |

Built surfaces are the reference implementations: Home (`surfaces/Home.tsx`), Plays (list-led), Patterns: When (chart-led). Music lists and the entity pages (`surfaces/Music.tsx`, `surfaces/entity/*`) follow Plays and Home's Most played.

Monthly charts that span a long quiet lead-in or a gap in the history start after the first 5% of the total when that cuts more than a year (`lib/leadIn.ts`), and say what they left out.

Outside the app, one page needs no session: a shared recap at `/s/:token`. It is server-rendered HTML with no script and no app shell (`src/share/html.ts`): the encore mark, the period, the headline, then the recap's sections with the same inline charts drawn in CSS (the dither tile as an SVG data URI). System fonts, the app's light and dark colour roles, one 680 px column with a 16 px gutter. Nothing on it links into the app or names the owner. Security model: [docs/sharing.md](docs/sharing.md).

### Where every old screen went

| Old screen (`git show main:web/src/screens/<File>.tsx`) | New home |
| --- | --- |
| Overview | Home (figures and chart under Your listening), Music (full rankings), Recaps/For you (the "waiting for you" column) |
| History | Plays |
| Explore (search, browse top lists) | Command palette (search), Music tabs (browse) |
| Entity (artist, album, song pages) | Music detail pages `/music/artist`, `/music/album`, `/music/song` |
| Forgotten | Music: Forgotten |
| Clock | Patterns: When |
| Eras | Patterns: Eras |
| Skips | Patterns: Skips |
| Trips | Patterns: Places (with devices) |
| Tag trends and energy (Eras/Overview panels) | Patterns: Taste |
| Picks | For you: Weekly picks |
| Releases | For you: New from your artists; artist pages show their releases |
| Sets, SetPage | Sets, `/sets/:id` |
| Session (DJ session) | Queue panel (desktop) and now-playing sheet (phone): the session shows next to the queue it drives, with Stop |
| Ask | Ask |
| Digests | Recaps |
| Cleanup (incl. blocks) | Library. Proposals by kind: Library Plans (the four ready-made rule plans). Select and Remove: the plan page (tick, Archive or Remove, Apply). Applied with Undo: Plans, Applied, and the plan page. Blocks: Library Instructions |
| Settings (incl. onboarding parts) | Setup (first run and missing steps), Settings (everything that stays) |
| SignIn | Sign-in screen outside the shell (`surfaces/SignIn.tsx`) |

No capability was dropped. Old URLs are not redirected. The first Library (`surfaces/Library.tsx`, proposals in four tabs) became the Library tabs above; its counts are the ready-made plans, and Dismiss is per song or per plan on the plan page.

### Where Overview went (November 2026)

Overview became Home: it answers "what should I listen to now, and what is new for me" first and "how have I been listening" second. The nav item is Home (`G` then `H`): the owner calls it the home, and the page no longer only overviews listening.

| Overview (part) | Home |
| --- | --- |
| Range picker in the header | Your listening section's actions (it only scopes that section) |
| Time listened, Plays, Listens with the change from the range before, driving the halftone chart | Your listening, chart 180 tall (140 on a phone; was 260 and 180) |
| Top artists, songs, albums (10 each), counts, Show all, Start a session | Your listening, 5 each; Show all to Music for the rest |
| On this day | Your listening, side column |
| Waiting for you: new picks | This week's picks (three with Claude's reason, Play, Show all to Weekly picks) and the Weekly picks cover's line |
| Waiting for you: new releases | New releases (three unseen, Show all to New from your artists) and that cover's line |
| Waiting for you: the latest recap | Latest recap |
| Spotify not connected, paused, last check failed | The same notice, under the title |
| First use (no plays) | The same first-use state, pointing to Setup, saying what Home will hold |
| (new) | Made for you: the playlists by cover, a sideways shelf on a phone; one composer that sends the text to Ask or to Sets (`?q=`), where the run starts and is followed; the latest set |

### For you as bands (November 2026)

The owner found For you empty: only the strip of covers. The index now shows what each playlist holds; Home keeps the covers.

| Before | Now |
| --- | --- |
| Six covers with a name and freshness line | A band per playlist: cover, what it is, the freshness line with "in your Spotify", Play, its first songs |
| Weekly picks: the cover's "new picks" line | The lead band: three picks with Claude's reasons; the run's state when there are none yet |
| New from your artists: the cover's "new releases" line | Its band shows the releases themselves |
| Playlist with nothing in it: a cover saying "Nothing in it yet" | One short row saying what fills it |
| Period playlists (saved from recaps, years kept when they ended): only on each recap page | Also listed under From your recaps |

### Home leads with this week (November 2026)

All-time totals barely change from one day to the next, so they no longer lead Home. The owner chose this order: this week, Made for you, the composer beside what is new, then the top lists beside On this day.

| Before | Now |
| --- | --- |
| Made for you, six large covers, first | Second, one row of smaller covers (a sideways shelf with snap on a phone) |
| Your listening: Time listened, Plays, Listens with the change from the range before | This week: hours so far against the usual (the same stretch, to the same hour, of the four weeks before), from `stats/week`. The range's hours and plays are one line under Most played; Patterns: When shows Time listened and Plays for any range |
| Your listening: the chart of the whole range (180 tall) | This week: the last 30 days, a day per bar (120 tall, 96 on a phone). The chart over a whole range left Home and is on no other surface |
| Top artists, songs, albums under the range picker of Your listening | Most played, with the range picker in its own actions (All time is one of the ranges; Show all to Music) |
| Latest set | Left Home: Sets lists every set, and the composer makes one |
| (new) | This week's top artist and top song, with artwork |

### Where the For you tabs went (November 2026)

For you was three tabs (Picks, Releases, Playlists) over the same things twice: Weekly picks is the picks, New from your artists is the releases. Now the playlists lead, by cover, and each tab's content lives in its playlist's page. Old URLs (`/for-you/releases`, `/for-you/playlists`, `/for-you/playlists/:kind`) are not redirected; `/for-you/picks` is Weekly picks' page.

| Old (tab: capability) | Now |
| --- | --- |
| Picks: this week's picks with Claude's reason, source link, album, year, "further from what you play", how each did | Weekly picks page, This week |
| Picks: Save, Not now, Never suggest again, Undo, Play, Add to queue, Go to artist, Open in Spotify (per pick) | Weekly picks page, each pick's row and its menu |
| Picks: Play picks | Weekly picks page header: Play (this week's picks are the playlist); an earlier week has Play that week |
| Picks: week picker (`?week=`) | Weekly picks page, This week's section actions |
| Picks: Pick this week's songs, the run (running, Cancel, Stopped, failed, Claude not set up, cap spent, Spotify paused), the scheduled time | Weekly picks page, This week, when the week has no picks |
| Picks: How picks did | Weekly picks page, under the picks |
| Picks: Blocked songs and artists, Allow | Weekly picks page, last section (and Library) |
| Releases: New and Last 30 days, Mark seen, Mark all seen, Play, Go to artist, Open in Spotify, Watching N artists, checked when, Nothing new, not run yet | New from your artists page, Releases, above the playlist's songs |
| Playlists: the five playlists, cover, what each holds, status (deleted, failed, waiting, not in Spotify yet, songs and updated) | For you, the covers: name and one freshness line (a problem first, then new picks or releases, then updated when, or not in Spotify) |
| Playlists: Keep in Spotify switch | The playlist's page header (the list no longer has switches) |
| Playlists: none on, connect Spotify, no permission to change playlists | For you and every playlist page: the same notices |
| Playlist page: songs or "would start with", Refresh now, Open in Spotify, failed, deferred, deleted, nothing new, Changes and each change's songs | The playlist's page, unchanged, plus Play (plays it in Spotify when kept there, otherwise its songs) |
| "Waiting for you" on Overview: new picks, new releases | The For you covers' freshness line, and Home |

## 2. Tokens

All in `web/src/styles/tokens.css`. Components use the Tailwind names in the right column, never a literal colour, radius, shadow or size. Light is the default; `.dark` on `<html>` swaps the values (set before paint by `public/theme.js`).

### Colour roles

| Role | Tailwind | Use |
| --- | --- | --- |
| Shell | `bg-shell` | Window, sidebar, player bar, phone tab bar |
| Page | `bg-page` | The inset content panel |
| Container | `bg-container` | Side panels (queue) |
| Card | `bg-card` | A faint grouping fill when spacing cannot group |
| Sunken | `bg-sunken` | Wells |
| Overlay | `bg-overlay` | Menus, popovers, dialogs, sheets |
| Standout | `bg-standout`, `text-on-standout`, `text-on-standout-secondary` | Tooltip, toast |
| Fills | `bg-fill`, `-hover`, `-active`, `-raised`, `-raised-hover`, `-inverted`, `-inverted-hover`, `-on-standout` | Controls. Translucent, so they work on any surface |
| Text | `text-primary`, `text-secondary`, `text-tertiary`, `text-disabled`, `text-inverted` | Opaque greys, so icons stay crisp |
| Lines | `line`, `line-subtle`, `line-strong`, `focus` | Hairlines (0.5px) and the focus ring |
| Accent | `bg-accent`, `-hover`, `text-on-accent`, `text-accent-text`, `bg-accent-subtle` | Spotify green: the primary play action, selection, playing state, chart emphasis, the encore mark. Nothing else |
| Status | `text-danger`, `bg-danger-subtle`, `text-warning`, `bg-warning-subtle` | Errors, destructive actions, notices |
| Chart | `chart-key`, `chart-empty`, `chart-grid`, `chart-axis` | Around the dither canvases |

Positive change uses neutral text (see Delta), not a green: the accent is reserved.

### Type

Geist Variable (`font-sans`) for everything; Bricolage Grotesque Variable at 600 (`font-display`) for page titles, figures and the wordmark only, with tight tracking (the type styles below carry weight and tracking). Never italic. Scripts the display face lacks (Arabic) fall back to the system face.

| Style | Desktop | Phone | Use |
| --- | --- | --- | --- |
| `text-display` | 40/44 display | 32/36 | Reserved (a recap headline) |
| `text-title` | 30/36 display | 28/32 | Page title (`PageHeader`) |
| `text-figure` | 28/36 display | 24/30 | Stat figures, always `tabular` |
| `text-heading` | 15/20 medium | 17/24 | Section titles |
| `text-body` | 14/20 | 16/24 | Reading text, sentences |
| `text-body-sm` | 13/18 | 15/20 | Default UI text (body) |
| `text-caption` | 12/16 | 14/20 | Secondary lines, axes, metadata |
| `text-label` | 11/14 | 12/16 | Key caps, tab bar labels |

Weights: 400, 500 (labels, titles), 600 (the display face; otherwise rare). Numbers that line up use `tabular` (tabular, lining figures).

### Space, size, radius, shadow, motion

- Spacing is Tailwind's 4px scale. Page gutter `--gutter` 32 (phone 20). Section gap 40 (`gap-10`), header to content 24–32, row internal gap 12.
- Controls: `--control-h` 32 / `-sm` 28 / `-lg` 40; phone 44 / 44 / 48 (44 is the touch floor). Rows: `--row-h` 44, compact 36; phone 60 / 48.
- Shell: `--sidebar-w` 232, `--panel-w` 360, `--player-h` 72, `--tabbar-h` 56, `--mini-player-h` 64, `--page-max` 1200 (the page frame, gutter included), `--measure` 720 (the reading measure), `--inset` 8 (0 on phone).
- `--bottom-chrome` on `:root`: the height the shell pins to the foot of the screen, safe area included. Player bar on desktop; tab bar, plus the mini player while one shows, on a phone; the keyboard's height while the software keyboard is up. Anything fixed to the bottom (toasts, sheets) sits above it. It lives on the root because overlays render in a portal outside the shell.
- Radius: `rounded-xs` 4, `sm` 6, `md` 8 (controls, rows), `lg` 10, `xl` 12 (page panel), `2xl` 16 (dialogs), `full`.
- Shadows: `shadow-control`, `shadow-panel`, `shadow-overlay`, `shadow-modal`. Dark mode replaces drops with an inset hairline.
- Motion: `--dur-hover` 150, `--dur-swap` 200, `--dur-modal` 240, `--dur-move` 300; eases `ease-out`, `ease-(--ease-move)`, `ease-(--ease-drawer)`. Every animation has a reduced-motion branch (the global rule in `app.css` makes them instant). No bounce, no spring overshoot.

## 3. Icons

Phosphor, regular weight; `fill` only for the active nav item and the playing state. Import from `web/src/ui/icons.ts` (add a re-export there for a new glyph) and draw with `<Icon icon={…} size="sm|md|lg" />` (16/20/24 in an even box). Icons label actions and nav; never decoration, never in coloured tiles. An icon-only control is an `IconButton` with a `label`.

## 4. Layout recipes

- **Shell** (`app/Shell.tsx`). Desktop: `[sidebar | page panel | queue panel]` over the player bar; the sidebar lists every surface in three unlabelled groups, Settings at its foot. The page panel is the scroll container (`useScrollElement()`). Phone: page, mini player, tab bar; More and the now-playing sheet are bottom sheets.
- **Page frame** (`ui/Page.tsx`). One frame on every page: a column `--page-max` (1200) wide with the gutter (`--gutter` 32, phone 20) inside it, so content is 1136 wide, centred in the page panel (at 1280 and 1440 it fills the panel; at 1920 it sits centred with 240 on each side). A band at the top holds the breadcrumb trail: 48 tall on desktop and always reserved, so every title, tab strip and first content line starts on the frame's left edge at the same offset (title top 48 from the panel's top). Pages set no width of their own. The one exception is the reading measure: `Page width="read"` keeps the frame, header and tabs, and holds everything under the header to `--measure` (720), left-aligned on the frame edge. It is for forms and long reading text: Settings, a recap, Sets.
- **Breadcrumbs** (`ui/Breadcrumbs`, from `trailFor` in `app/nav.ts`). Only on a page below its surface: an entity, a set, a thread, a recap, a For you playlist, a Library plan, the songs behind a Library figure, a Library conversation. The trail is the surface, then the tab that owns the page (`SurfaceTab.owns`: Music › Artists › Mac Miller), then the page's own name, not a link, `aria-current="page"`. A top-level page and a tab of one show no trail: the sidebar and the tab strip already say where you are, and a single crumb would repeat the title (Settings › Spotify is the Settings tab strip, not a trail). The page passes its name as `Page crumb`: undefined while it loads (a short skeleton bar in its place), null when it failed (the trail ends at the parent, which is still a link). Middle crumbs and the name truncate, with the full text in `title`. Phone: no trail, one "‹ Parent" link (44 tall) in the band; a top-level page has a 24 band and no link.
- **Page header** (`PageHeader`). `PageHeader title actions secondary` (+ `TabNav` as children for a surface with tabs) > sections 40px apart (48 from `md`; `SECTIONS` for a body under a shared header). Title left, actions on the same row at every width, right-aligned (bottom-aligned with the title on desktop, centred on its first line on a phone), at their full size: a long title wraps to two lines, then ends in an ellipsis. `secondary` actions sit before `actions` on desktop and fold into one More menu on a phone, so the row never holds more than the primary action and More. The range picker sits in the header actions of every ranged surface. An entity header puts its `aside` (the range picker) top right at every width, beside the artwork on a phone. One primary or accent button per surface: once a step is done, its repeat action (Connect again, import again) is secondary.
- **Patterns tab** (`surfaces/PatternsFrame.tsx`). Every Patterns tab renders through `PatternsFrame`: header, `TabNav`, range picker, first-use state. A tab only supplies its body.
- **Stat strip driving one chart.** At most three figures; the selected one draws the chart below it. Never a row of identical metric boxes.
- **Ranked list.** `RowList` of `TrackRow`/`ArtistRow`/`AlbumRow`: rank, art, title over subtitle, dither meter (when the list is 512px or wider), figure. Whole row is the link; songs get play and menu on hover, a context menu on right click. On desktop the actions overlay the figure (the figure hides while they show), so a row reserves no width for them; on a phone they sit in the row. Art: 32 in ranked lists and side columns (40 on a phone), 40 in rows with a second line of detail (skips, cleanup proposals, set songs, the queue), 48 in release and set lists, 64 for picks and the playlist list (the fixed cover). A set's art is its generated cover (`coverUrl`, the image saved as the playlist cover), in the set list and the set page header.
- **Log table.** Plays: virtualised rows grouped by day headings, columns that drop by width (`useColumns`), a phone row layout. Toolbar above, count line, then the table.
- **Entity page.** `EntityHeader` (artwork, title, credits, first and last play, Play plus secondary actions, range picker as `aside`) > stat strip driving the listening chart > main plus side column (ranked songs; albums, releases, versions) > skips in context, full width.
- **Main plus side column.** `SIDE_COLUMNS` (`lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]`): the main answer left, small related lists right.
- **Setting rows.** `SettingRows` separates rows with spacing only, no hairlines; a section heading groups them. A hairline is kept for selection or a table, never to divide settings.
- **Conversation panel** (`ConversationPanel` in `ui/Conversation`). Every conversation with Claude next to content (the set page, Ask, Library) is one docked panel, built once: its own surface (`bg-card`, `rounded-2xl`, the panel hairline from `shadow-panel`), a header row that names it ("Change the set", "Claude asks", a thread's title, "New question") with its actions (a thread's More), the thread scrolling inside the panel, and the composer pinned at the panel's foot with the notices tied to it (a failed run with Try again, Stopped, Claude not set up, the cap spent, Spotify paused) and the monthly spend in the composer's footer. Nothing else is boxed inside it: messages are text, Claude's visuals and the owner's bubbles, the composer is the one control. From `lg` (`useDocked`) it docks in a page column: `DOCKED` makes it sticky under the frame's top band (top 48, the title line) and one gutter above the foot of the page panel, its right edge on the frame's right edge (set page: `[content | --panel-w]`; Ask: `[280 thread list | panel]`, the Ask title heading the thread list). Narrower, the set page opens it as a bottom sheet from a "Change" button in the header actions ("Answer" while Claude's question waits; "Changing…" while a run goes): the sheet is full height less 24, so the composer sits at its foot above the keyboard (the viewport resizes for it) and the home indicator, and it covers the tab bar and mini player while open. It stays mounted while closed, so a run keeps reporting and the set refreshes when it ends. On Ask the conversation is the page, so on a phone it has no surface: the page scrolls, the composer sticks above the tab bar, and a thread's title row sits over it. Inside, `Conversation` keeps its behaviour: with no messages the composer sits at the top with the starters under it; from the first message, or a starting run, it is pinned to the foot and the view follows new messages and a streaming run while the reader is at the end; scrolled up, Jump to latest appears above the composer. During a run the send button is Stop, so `RunProgress` in a thread has no Cancel. The composer glides between the two places (`--dur-move`, `--ease-move`; instant with reduced motion).
- **Home** (`surfaces/Home.tsx`). This week (`SIDE_COLUMNS`: the hours so far as the figure, a line with `InlinePair` and `InlineChange` against the usual, the last 30 days as `DitherBars` | Top this week, artist and song rows) > Made for you (one row of smaller covers) > `SIDE_COLUMNS`: the composer (Ask or Make a set, a two-way toggle in its footer; Claude not set up or the cap spent shows as its notice) over This week's picks | New releases, Latest recap, each only when there is one > `SIDE_COLUMNS`: Most played (the range's hours and plays as its line, range picker in its actions, Artists, Songs, Albums tabs) | On this day. This week: "this week" is the recap week that holds today (weeks end the day before the recap weekday); "usual" is the mean of the same stretch, to the same local hour, of the four weeks before that the history covers whole. With none, the figure stands alone with its play count; with nothing played yet it says so and what is usual by now. Nothing on Home starts a run or playback by itself: sending the composer opens Ask or Sets with `?q=`, which start the run there (deferred a tick, so a StrictMode double mount never starts or abandons one).
- **Covers** (Home). The playlists encore makes by their generated covers. `PlaylistCovers` lays them out as a grid (2 columns on a phone, 3 from `md`, 6 from `xl`; no surface uses it since For you became bands) or, with `compact`, one row, each with its name and one freshness line under it; the line is `text-primary` when it says something is new, `text-danger` for a problem. (Home: six smaller covers, at most 144 wide, on a wider screen; a sideways shelf with snap on a phone). The cover and lines are one link to the playlist. With a mouse, Play (accent, round, 40) shows inside the cover's top-right corner, 8 from both edges, on hover or keyboard focus: it fades in and rises 4 px over `--dur-hover`, `ease-out`. It sits top right because the title drawn on the cover fills its foot, across most of its width. It plays the playlist in Spotify when kept there, otherwise its songs. On a touch screen there is no Play on the cover: the cover opens the playlist, and its page has Play.
- **For you bands** (`surfaces/ForYou.tsx`). Each playlist is a band, one under the other 48 apart (56 from `md`), no boxes: its cover (cover and name open the playlist's page), the name, what it is, one line that says a problem, what is new or how fresh it is, and "in your Spotify" when kept there, Play at the right of the name, then what it holds. The treatment follows the playlist: Weekly picks leads (cover 160, the only accent Play; three picks with Claude's reason, the same rows as Home; with none yet, one line: Claude choosing them now, why it cannot, or when it will, and a link to Weekly picks where the run starts); New from your artists shows the releases (four `ReleaseRow`s, the playlist's songs when there are none); Most played lately is a ranking (its first five songs, numbered); the look backs (Forgotten favourites, This month in past years, This year so far) take a 64 cover and three songs across the band. Songs are `Row`s with play and the song menu. A playlist with nothing to put in it is one row: cover 40, name, what fills it. Keep in Spotify, Refresh, the full list and the changes live on the playlist's page only. Under the bands, From your recaps lists the period playlists encore made in Spotify (saved from a recap, or a year kept when it ended), two columns from `md`; each opens its recap, with Open in Spotify; hidden while there are none.
- **Plan review** (`surfaces/library/PlanPage`). Header with Apply (primary, names the count) and Dismiss as a `secondary` action (a More menu on a phone). Under it the apply as the server reports it (`BatchStatus`: progress while running, what was and was not applied, skipped songs with their reasons, Undo); it never says failed while a batch runs. Songs are grouped by action and place: a group heading with a tick for the whole group and Archive or Remove, then rows with a tick, art 40, the reason, and a menu (switch, Dismiss). Status tabs (To review, Applied, Skipped, Dismissed) show only when they hold songs. A Claude plan has its conversation in the docked `ConversationPanel` ("Change the plan", `[content | --panel-w]` from `lg`); narrower, it opens as the bottom sheet from "Change with Claude", a `secondary` header action ("Changing…" while a run goes). A conversation whose first turn was Claude's question (`/library/claude/:id`) is the page at the reading measure. The Apply confirm states each consequence, including the new date added for liked songs taken out.
- **Recap** (`surfaces/Recaps.tsx`, `/recaps/:week|month|year/:key`). A page below Recaps at the reading measure: the trail is Recaps › the period ("Recaps › October 2026"), the title is the period, Share is a `secondary` header action (a More menu on a phone). Under the title row, Week, Month and Year (`Segmented`) then the arrows to the period before and after; the arrows carry no label, since the title already names the period. Then the headline (`text-display`), the comparison and written line, the sections. Play and Save to Spotify sit on the songs section, above the songs they act on. `/recaps` and `/recaps/:length` open the newest period; `/recaps/:id` (old links) redirects to its period.
- **Start a session.** `StartSessionButton` (secondary, small) sits beside a list of songs worth a session (Home top songs, Forgotten, an era, keepers in Skips, a trip). It opens the queue panel, where the session runs.

### Phone and touch

The platform layer lives in `styles/app.css`, `styles/tokens.css`, `app/Shell.tsx` and `app/keyboard.ts`; a surface does not repeat it.

- **Hover only with a mouse.** `hover:` and `group-hover:` apply under `(hover: hover) and (pointer: fine)`. On a touch screen `hover:` styles show while pressed (`:active`), so every control answers a press within `--dur-hover`. Hand-written hover CSS goes in the same query. Actions revealed on hover hide only under `can-hover:`; on a touch screen they always show, in the row.
- **Press, not release.** `press` (scale 0.97) on buttons and tabs; no feedback that waits for `click`. No tap highlight (`-webkit-tap-highlight-color: transparent` on the root).
- **Controls are not text.** Buttons, tabs, menu items, options, switches, checkboxes and nav links take `user-select: none` and `-webkit-touch-callout: none`. Content (names, figures, errors, links in text) stays selectable. Controls and fields take `touch-action: manipulation`.
- **Fields are 16px on a touch screen** (an unlayered rule beats the `text-*` utilities), so iOS never zooms. Never `maximum-scale` or `user-scalable=no`. Set the keyboard: `enterKeyHint` (send, search, go), `autoCapitalize="none"` and `autoCorrect="off"` on search and name fields.
- **Heights.** The shell is `100dvh`. While the software keyboard is up on a phone, the shell fits the visible area above it, the tab bar and mini player hide, and `--bottom-chrome` becomes the keyboard's height (`app/keyboard.ts`; iOS pans the page under the keyboard otherwise). A pinned composer stays on the keyboard; a thread at its end stays at its end.
- **Scroll.** The root does not bounce or pull to refresh (`overscroll-behavior: none`); the page panel, sheets, popups, the palette list and tab strips contain their own scroll (`overscroll-contain`, `overscroll-x-contain`). Never a `touchmove` listener to stop scrolling.
- **Safe areas.** `viewport-fit=cover`. The page pads the top and sides, the tab bar and the desktop grid pad the sides and bottom, sheets pad the bottom, toasts keep 16px from the side insets. Use `env(safe-area-inset-*, 0px)` inside `calc()`.
- **Sheets.** A bottom sheet's max height is the visible area minus the top inset and 24px. Opened by touch, a sheet focuses itself, not its first control (`focusSheetOnTouch`).
- **Horizontal strips** (`TabNav`, `TabList`, filter rows) scroll natively under the gutter with no scrollbar; `TabNav` brings the current tab into view. A chart that scrubs on hover takes `touch-pan-y`: a sideways drag scrubs, a vertical one scrolls the page.
- **Status bar.** On a phone the root paints `bg-page`, the colour at the top of the screen; `theme-color` follows the chosen theme, set before paint by `public/theme.js` and on change by `lib/theme.ts`.
- **Targets.** 44px on a phone (`--control-h`), `touch-target` round a smaller mark. A link inside a truncated line cannot grow past the line's box: give the line the padding, or make a neighbouring element (the artwork) a second way in.
- Emulation does not show sticky hover, tap delay, rubber banding, safe areas or the keyboard. Check those on an iPhone, in Safari and from the home screen.

### State order

Every data block resolves in this order, and builds each state with the shared components:

1. **Error** (`ErrorState` with retry) before anything else.
2. **Loading** (`Skeleton`, `RowSkeleton`, `ChartSkeleton`) in the shape of the content.
3. **First use** (`FirstUseState`: "No listening yet" and "Set up encore").
4. **Empty for this range or filter** (`EmptyState size="section"` with the control that widens it).
5. **Content**, including worst case: long names truncate with the full value in the link label; 0, 1 and huge counts format with `fmtCompact`/`fmtInt`; missing or broken art falls back to the kind's placeholder glyph.

Refetches keep the old data dimmed (`dimWhile(refetching)`, `opacity-60`) instead of flashing a skeleton. An unknown address renders `NotFound` ("This page does not exist", Open Home); a missing recap, set, thread or entity says the same in its own page.

## 5. Components

All in `web/src/ui/` unless noted. Props listed are the ones that matter.

| Component | Import | Props |
| --- | --- | --- |
| `Button`, `buttonClass` | `ui/Button` | `variant` primary, accent, secondary, ghost, danger, standout (on a toast); `size` sm, md, lg; `icon`, `iconEnd`, `busy`, `busyLabel`. `cx` does not merge classes: pick a variant rather than overriding its colours |
| `IconButton`, `iconButtonClass` | `ui/Button` | `icon`, `label` (required), `variant`, `size`, `fill` |
| `Input`, `Field` | `ui/Field` | Input: `icon`, `end`, `invalid`. Field: `label`, `hint`, `error`, render-prop child gets `id`, `aria-describedby`, `invalid` |
| `Select` | `ui/Select` | `value`, `onChange`, `options`, `label` |
| `Switch` | `ui/Switch` | `checked`, `onChange`, `label`, `disabled`, `id` (pair with a visible `<label htmlFor>`). Hit area 24px tall on desktop |
| `Checkbox` | `ui/Checkbox` | `checked`, `indeterminate`, `onChange`, `label`, `id`. 44px hit area on a phone |
| `Combobox`, `ComboboxOption` | `ui/Combobox` | Search a long list (timezones): `value`, `onChange`, `options { value, label, detail? }`, `placeholder`, `emptyText`, `invalid` |
| `WeekdayPicker` | `ui/WeekdayPicker` | Several days, ISO 1 (Mon) to 7 (Sun): `value`, `onChange`, `label` |
| `SettingRow`, `SettingRows` | `ui/SettingRow` | Label and hint left, control right (stacked on a phone). Rows separated by spacing, no hairlines. `label`, `hint`, `error` (replaces the hint), `wide`; render-prop child gets `id`, `aria-describedby`, `invalid` |
| `CopyField` | `ui/CopyField` | A read-only value to paste elsewhere (redirect URI, endpoint): `value`, `label` |
| `Notice` | `ui/Notice` | The one notice: gates, paused calls, failed runs, save effects. One sentence that changes what the user does next: `tone` info, warning, danger; `action`; `onRetry` adds Try again. Full bleed on a phone |
| `DropZone` | `ui/DropZone` | `onFiles`, `accept`, `multiple`, `title`, `description`, `button`. Unpainted until a drag is over it |
| `Segmented` | `ui/Segmented` | Two to four views of the same data: `value`, `onChange`, `options`, `label`. Full width on a phone |
| `TabsRoot`, `TabList`, `TabPanel` | `ui/Segmented` | In-page tabs with an underline |
| `TabNav` | `ui/TabNav` | Route tabs under a page header: `items`, `label` |
| `MenuRoot`, `MenuTrigger`, `MoreTrigger`, `MenuPopup`, `MenuItem`, `MenuLinkItem`, `MenuSeparator`, `MenuLabel` | `ui/Menu` | Item: `icon`, `danger`, `hint`. MoreTrigger: the dots button, `label` ("More for Woods"), `size` sm or md |
| `Dialog`, `DialogClose`, `Confirm` | `ui/Dialog` | Dialog: `open`, `onOpenChange`, `title`, `description`, `footer`, `width` 440, 560, 720 (bottom sheet on phone). Confirm: `action`, `danger`, `busy`, `onConfirm`. Prefer undo over confirm |
| `PopoverRoot`, `PopoverTrigger`, `PopoverPopup` | `ui/Popover` | `align` |
| `Tooltip` | `ui/Tooltip` | `label`, `side`. Never the only place information lives |
| `showToast`, `Toaster` | `lib/toast`, `ui/Toast` | `showToast(message, "info" | "problem", { label, onClick })`. One at a time: a new toast replaces the one showing. Info closes after 4 s, a toast with an action (Undo) after 8 s, a problem stays until dismissed. Hover, focus or a finger on it pauses the timer; a touch elsewhere resumes it. Close button, Escape, or a swipe down or sideways dismisses it. It sits 12px above `--bottom-chrome`, never over the tab bar, mini player or player bar |
| `Skeleton`, `ChartSkeleton` | `ui/Skeleton` | Skeleton: `className` sets the shape. ChartSkeleton: `shape` bars or grid, in the chart's box |
| `EmptyState`, `FirstUseState` | `ui/States` | EmptyState: `icon`, `title`, `description`, `action`, `size` page, section, inline. FirstUseState: before any play is imported, `icon`, `description`, `title` (default "No listening yet"), action Set up encore |
| `ErrorState` | `ui/States` | `error`, `onRetry`, `title`, `size` |
| `Page`, `PageHeader`, `Section`, `useDocumentTitle`, `SECTIONS`, `SIDE_COLUMNS`, `dimWhile` | `ui/Page` | Page: `width` data or read, `crumb` (this page's name in the breadcrumb trail: undefined loading, null failed). PageHeader: `title`, `description`, `actions`, `secondary` (`HeaderAction[]`: buttons on desktop, a More menu on a phone), children. Section: `title`, `description`, `actions`, `labelledBy` |
| `Breadcrumbs` | `ui/Breadcrumbs` | Rendered by `Page`; `trail` from `trailFor(location)`, `current` |
| `Stat`, `StatStrip`, `Delta` | `ui/Stat` | Items `{ id, label, value, unit?, delta?, compare? }`; StatStrip: `value`, `onChange`, `label`, children (the chart) |
| `AnimatedNumber` | `ui/AnimatedNumber` | `value` (formatted string) |
| `RowList`, `Row`, `TrackRow`, `ArtistRow`, `AlbumRow`, `RowSkeleton` | `ui/Rows` | `rank`, `value`, `share` (0 to 1, draws the meter), `subtitle`, `style` (position in a virtualised list). `Row` links only when given `to` (a song with no page, such as an unheard pick, stays plain). Set `--rank-w` on the list for ranks past 99 |
| `TableHead`, `useColumns`, `cellClass`, `Column` | `ui/Table` | Columns `{ id, label, width, align, from, srLabel }` drop below their `from` breakpoint |
| `EntityHeader`, `EntityHeaderSkeleton` | `ui/EntityHeader` | `title`, `art`, `kind`, `credits`, `detail`, `actions`, `aside`. The head of an artist, album, song or set page; the page sets the document title |
| `SearchField` | `ui/SearchField` | `value`, `onChange` (after a 250 ms pause), `label`, `placeholder` |
| `Artwork` | `ui/Artwork` | `src`, `kind` artist, album, song, playlist, `box` 24 to 64 or fill. Kind sets the shape (artists round) and the placeholder glyph. Loading is the bare fill; missing and broken images show the kind's glyph (microphone, record, note, playlist) in `text-tertiary` on `bg-fill`. Decorative: the name sits beside it |
| `SongMenu`, `SongContext` | `ui/SongMenu` | `song { uri, name, songKey?, artist? }` |
| `RangePicker` | `ui/RangePicker` | Reads and writes `from`/`to` in the URL |
| `AnswerView`, `answerFromText` | `ui/Answer` | A structured answer from Claude (`Answer` in `api/types`): paragraphs with inline visuals, block visuals between them on the conversation's surface (no card), a dotted `text-warning` underline under a number no tool returned with one caption line saying so, and Based on folded away. `answerFromText(text, visuals)` splits streaming text, or an answer written before answers were structured, the same way the server does: a block whose visual has not arrived holds its place as a skeleton, a half-written marker is hidden. Not tied to Ask |
| `InlineVisual`, `BlockVisual` | `ui/AnswerVisual` | One answer visual. Inline: `pair` (`InlinePair` and `InlineChange`), `share` (`InlineShare`), `series` (`InlineColumns`, the peak marked). Block: `ranked` (title, then `Row`s: songs play and open their page, artists and albums open theirs; meters from `@lg`), `series` (`DitherBars`, 160 tall, View data), `compare` (labels, `PairMeter` from `@md`, now and before figures under the two labels, View data). A block with nothing in it says "Nothing in this period." under its title |
| `RunProgress` | `ui/RunProgress` | `run` (from `useRun`), `title`, `onCancel` (omit in a `Conversation`: the composer's Stop cancels) |
| `Composer` | `ui/Composer` | `value`, `onChange`, `onSubmit`, `onStop`, `running`, `label`, `notice`, `footer` |
| `ConversationPanel`, `DOCKED`, `useDocked` | `ui/Conversation` | The docked panel: `title`, `actions`, `sheet` (`{ open, onOpenChange }`: a bottom sheet below `lg`), `flatHeader` (the title row when it is the page on a phone), `className` (`DOCKED` in a page column), plus every `Conversation` prop |
| `Conversation` | `ui/Conversation` | The thread inside: `messages` (null while empty), `composer` (the composer with its notices), `empty` (starters, under the composer while empty), `follow` (changes when a message is added), `startAtEnd`, `thread`, `contained` (own scroll box, fills the parent's height), `inset` (pads off a surface) |
| `useClaudeGate` | `ui/ClaudeNotice` | Gate: `needsSpotify`; returns `ready`, `blocked` (no API key, monthly cap spent: disable the run and show it as the composer `notice`), `warning` (Spotify paused, shown as a `Notice`), `spend` (composer `footer`) |
| `StartSessionButton` | `ui/StartSessionButton` | Starts a DJ session and opens the queue panel |
| `BlockedList` | `surfaces/BlockedList` | Songs and artists kept out of picks and sets, with Allow. Picks and Library |
| `Kbd`, `MOD_KEY` | `ui/Kbd` | Hidden on touch screens |
| `Icon` | `ui/Icon` | `icon`, `size`, `fill` |
| `EncoreMark`, `Lockup` | `ui/Brand` | Mark at 16, 32 or 48 only, in `text-accent-text` (Spotify green on dark, the deeper green on light, where Spotify green is 1.7:1 on the shell). The wordmark stays `text-primary`. Lockup 16 or 32: the wordmark's box is trimmed to its x-height band (`text-box: trim-both ex alphabetic`; "encore" has no ascenders or descenders) and centred on the mark's centre, measured equal at both sizes (sidebar 16, sign-in 32, in `/dev/kit`). `public/favicon.svg` and `logo.svg` follow the colour scheme the same way; the PNG app icons draw the mark in Spotify green on near-black |
| `AppLink`, `useRangeHref` | `ui/AppLink` | A link that keeps the current range |
| Paths | `app/paths` | `artistPath(name)`, `songPath(key)`, `albumPath(artist, album)` |

`/dev/kit` (dev builds only) shows every primitive in its states. Fixtures: add `?fixture=loading|error|empty|new|worst|untagged|off`, `?player=playing`, `?dj=active` or `?run=running|starting|done|failed|budget|unconfigured|paused` (Claude runs answered by the fixture, never the server), `?history=before|none|slow|failed|env` (Settings, Ignore plays before; answered by the fixture, nothing deleted), `?living=connected|first|fresh|deferred|failed|empty|removed|scope|refreshing|kept` (For you and its playlists; `kept`: every playlist on and in Spotify; switches and refreshes answered by the fixture, nothing sent to Spotify), `?library=apply|running|done|partial|failed|undoing|undofailed|undone|disconnected|unsynced` (Library apply and undo states; Apply and Undo answered by the fixture, no Spotify call), `?ask=empty` (Ask: every chart in a stored answer with nothing in it), `?picks=none` (this week has no picks yet), `?playlists=saved` (For you, From your recaps: three period playlists, one without a cover), `?week=quiet|first` (Home, This week: nothing played yet this week; no earlier weeks to compare with), `?recap=none|facts|first|quiet|spotify|saved` (Recaps: real periods bent to no recap yet, no Claude lines, history starting inside the period, almost no listening, Spotify connected, the playlist already saved; saving answered by the fixture) to any dev URL (`web/src/dev/fixtures.ts`); the choice sticks for the tab until `off`.

## 6. Charts

One family: dithered halftone in Spotify green.

| Chart | Import | Use |
| --- | --- | --- |
| `DitherArea` | `charts/Dither` | One series over time (the stat strip chart) |
| `DitherBars`, `DitherStack`, `DitherLine`, `DitherRadar` | `charts/Dither` | Bars, stacked series, lines, radar. All draw through the vendored kit in `components/dither-kit/` |
| `DitherMeter` | `charts/DitherMeter` | A share bar in a row, always next to a printed figure |
| `ContextRates`, `contextRates()` | `charts/ContextRates` | Skip rate by context (weekday, hour, device, source) as `RateMeter` rows against the overall rate. Skips and the entity pages |
| `RateMeter` | `charts/RateMeter` | A rate on a fixed 0 to 100% track, with an optional tick for a reference rate (skip rate by context, share by device, how plays end on Skips). Next to a printed figure |
| `DitherHeatmap`, `HeatLegend` | `charts/DitherHeatmap` | A grid of values (weekday by hour, artist by month). One tab stop, arrow keys move the selection. Column labels can be elements (artist avatars on phone) |
| `BudgetBar` | `charts/BudgetBar` | Spend against a cap: `spent`, `cap`, `label`. Turns red with a cap mark once spent reaches the cap |
| `InlinePair` | `charts/Inline` | This period over the one before as two short bars on one scale (dithered now, grey before). Inside a sentence, next to the figures |
| `InlineChange` | `charts/Inline` | The change from before to now as an arrow and a percentage, in neutral ink ("new", "no change" when there is nothing to divide) |
| `InlineColumns` | `charts/Inline` | A word-sized row of columns (each day, each hour) with one marked column. Sums long series into at most `bars` columns |
| `InlineShare` | `charts/Inline` | A share of the whole on a short track, with a tick where it stood before |
| `PairMeter` | `charts/PairMeter` | Now over before as two row-sized bars on the list's shared scale (dithered now, grey before). Beside printed figures, in an answer's compare rows; hidden from assistive tech, the rows' View data carries the values |
| `ArtChip` | `charts/Inline` | 20 px artwork beside a name, clamped to one line. The name is the label; the image is decoration |
| `ditherTile(level)`, `levelFor(share)` | `charts/ditherTile` | The halftone as a CSS background for anything that is not a canvas |
| `DataTable` | `charts/DataTable` | "View data": the accessible table behind every chart |

Inline charts are sized for a line of text and sit next to the figure they draw, never in place of it. Each takes a `label`: the sentence a screen reader hears instead of the picture ("42 h, against 30 h in October"). Recaps and Ask answers use them. `/dev/kit` shows each one, and the answer visuals in a sample answer.

Rules: a chart answers one question and has a printed figure or sentence that states the answer ("Busiest: Fridays, 22:00 to 23:00"). Axis labels in `text-caption text-tertiary`. Every chart has a `DataTable`. Hover tooltips repeat data, they never hold it alone.

## 7. Copy

Apply the owner's ladder to every string: does it need to surface, does the label need to exist, does it pre-empt a problem the user never had? Delete at the first rung that fires.

- Sentence case. No exclamation marks. Numbers with units ("1,445 hours", "38 plays").
- Empty states say what is missing and the one step that fixes it: "No plays in this range" + the range picker.
- Errors say what failed and offer "Try again". No apology.
- Buttons are verbs: "Play", "Make a set", "Set up encore". A busy button swaps its label in place ("Waiting for passkey").
- Skips are context, never judgement: "Skipped", never "disliked". A play ends one of four ways, always in these words: Played through, Skipped early, Skipped midway, Interrupted. Leaving in a song's outro is Played through; going back or choosing another song is Interrupted, never a skip. A skip rate counts only plays whose ending is known.
- No hint under a self-explanatory label. No caption defending a design decision.

## 8. Do and don't

| Do | Don't |
| --- | --- |
| Hierarchy from type size, weight and spacing | Borders or boxes to fix weak hierarchy; cards inside cards |
| One stat strip driving one chart | Rows of identical metric boxes |
| Accent only for play, selection and chart emphasis | Green for "positive"; gradients, glows, glass |
| Display face for titles and figures, roman | Italic accent words, all-caps tracked eyebrows, monospace labels, numbered section labels |
| Plain metadata in secondary text | Pills or badges for ordinary metadata |
| Spacing between setting rows | Hairlines between setting rows |
| One primary button per surface | A primary Continue beside an accent Connect again |
| Missing art: the kind's glyph, muted, on the neutral fill | Identicons, dither or per-item colours as a placeholder; icons in coloured tiles |
| `EmptyState` and `ErrorState` from `ui/States` | Hand-made empty or error blocks |
| Tokens for every colour, radius, shadow, size | Literal values (`#…`, `text-[19px]`, `bg-white/10`) |
| 44px targets on phone; 24px with space on desktop | Small muted grey text to make density fit |
| Reduced-motion branch on every animation | Bounce, overshoot, motion that carries information alone |
| Play only on a user action | Autoplay, playback from a load or effect |
