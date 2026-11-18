# encore design

The contract for every screen in `web/`. Section 1 is the information architecture; the rest is how a surface is built. When this file and a screen disagree, the screen is wrong.

## 1. Information architecture

encore answers three jobs: **what have I been listening to**, **what should I play next**, and **keep my Spotify tidy**. Every surface belongs to one job and answers one question.

### Sitemap

```
Listening                      Spotify                                Foot
├── Home      /                ├── Playlists  /playlists              └── Settings /settings
├── Plays     /plays           │   ├── ?show=made|sets|rules|recaps       ├── general
├── Music     /music           │   ├── /playlists/:id  (a built-in kind,  ├── spotify
│   ├── Artists   /artists     │   │     rule-…, set-N)                   ├── claude
│   ├── Albums    /albums      │   ├── /playlists/:id/edit (a rule)       ├── integrations
│   ├── Songs     /songs       │   └── /playlists/new  (Build from rules) ├── jobs
│   ├── Forgotten /forgotten   └── Library    /library                    ├── data
│   ├── Podcasts  /podcasts                                               │
│   ├── /music/artist/:name                                               ├── alerts
│   ├── /music/album/:artist/:album        Secondary: Setup /setup        └── account
│   └── /music/song/:songKey               (until onboarding is done)
├── Patterns  /patterns
│   ├── When  Eras  Taste  Discovery  Records  Skips  Places
└── Recaps    /recaps  (a timeline of periods)
    └── /recaps/:kind/:key

Not in the sidebar: /ask and /ask/:id, the chat panel expanded (with AI set up).
Shell, on every surface: sidebar (desktop) or the floating dock + More sheet (phone), command palette (⌘K, G then key),
docked player bar with the queue panel (desktop) or mini player + now-playing sheet (phone), and the chat panel
(desktop: the queue's slot, one of the two at a time; phone: a full-screen sheet over the page and the dock), ⌘J.
With no AI provider set up, the chat button, ⌘J and every way into the chat are absent.

Library /library
├── Overview      /library               the state of liked songs and playlists
│   └── Songs     /library/songs         the songs behind one figure, with Make a plan
├── Plans         /library/plans         review, Claude, applied with Undo, dismissed
│   ├── Plan      /library/plans/:id
│   └── Claude    /library/claude/:id    a conversation whose first turn was a question
└── Instructions  /library/instructions  standing instructions, kept out of picks and sets
```

The source of truth for paths, labels, icons and shortcuts is `web/src/app/nav.ts`. The desktop sidebar shows two named groups, Listening (Home, Plays, Music, Patterns, Recaps) and Spotify (Playlists, Library), then Setup until onboarding is complete (read from `/api/onboarding`, hidden until it loads, shown while it is the open page), and Settings at the foot; there is no More menu. Settings (Open setup) and the palette still reach Setup. Phone tabs are Home, Music and Playlists plus More, a sheet with search and every other surface in sidebar order: the three a phone is picked up for (glance at the week, look up an artist, play something); Plays is a log to search, more at home on a desk. Chat is its own button beside the tabs, only with AI set up. Whether AI is set up is read in one place, `useAi()` (`lib/ai.ts`).

### Surfaces

| Surface | Answers | Primary action | API | Status |
| --- | --- | --- | --- | --- |
| Home `/` | How much have I listened this week, against my usual and against all time? Then, quieter: what should I play next? | None: Home reads; each block opens where the answer lives | `stats/week`, `stats/highlight`, `stats/overview` (all time, and the range's totals), `stats/timeseries`, `stats/on-this-day`, `stats/top/*`, `status`; then `living`, `picks`, `radar` (the playlists' lines), `digests` | Built |
| Plays `/plays` | What exactly did I play, when, where? | Search and filter the log. Select, then Delete (Undo toast); Trash lists deleted plays with Restore and Empty trash (confirm) | `history` (paged, `q`, `outcome`, `device`, `source`, `artist`, `songKey`, `trash`), `plays/trash`, `plays/restore`, `status`, `stats/overview` (first use) | Built |
| Music `/music/*` | Who and what do I play most, and which favourites did I drop? | Open an artist, album or song | `stats/top/*` (paged, `sort`, `q`), `stats/forgotten`, `stats/overview` (counts) | Built |
| Music: Podcasts | Which shows do I listen to, and what did I play last? | None: it reads | `stats/podcasts` | Built |
| Artist, album, song pages | Everything about one artist, album or song. Artist More menu: Count as another artist (Undo toast); Also counts lists aliases with Remove; an alias's page says where it went. Song menu: Delete its plays in the range (Undo toast) | Play it | `entities/artist`, `entities/album`, `entities/track`, `notes` (liner notes), `radar` (artist releases), `artists/aliases`, `plays/trash/song` | Built |
| Patterns: When | When in the week do I listen? | Pick a weekday and hour to see what fills it | `stats/clock`, `stats/top/tracks` and `top/artists` with `weekday` and `hour` | Built |
| Patterns: Eras | Which artists defined which months? | Pick an era | `stats/eras`, `entities/artist` and `stats/top/artists` for the picked month | Built |
| Patterns: Taste | Which genres, moods and energy over time, and from which decades? | Switch genres and moods | tag stats (`stats/tags/*`), `stats/timeseries`, `tags/pending`, `stats/decades` | Built |
| Patterns: Discovery | How much new music do I find, which artists came back, which stayed? | Pick a month to see what was new | `stats/discovery`, `stats/discovery/month`, `stats/comebacks`, `stats/loyalty` | Built |
| Patterns: Records | What are my biggest days, longest runs and milestones? | None: it reads | `stats/streaks`, `stats/records`, `stats/milestones` | Built |
| Patterns: Skips | How do plays end, and in what context do I skip? | Pick a moment class | `stats/skips` (with `summary.outcomes` and `profile`), `stats/skips/split` | Built |
| Patterns: Places | Where and on what do I listen (trips, devices)? | Pick a trip | `stats/trips`, `stats/devices` | Built |
| Playlists `/playlists` | What has encore made for me, is each fresh, and is it in my Spotify? | Play a playlist; New playlist (Describe it, Build from rules) | `living` (built-ins and rules, each with its first songs), `sets`, `digests/playlists`, `picks` (this week's, under Weekly picks), `radar` (its line), `living/:kind` and `sets/:id` (play one not in Spotify) | Built |
| A playlist `/playlists/:id` | What is in it, how does it fill, what changed, and is it in my Spotify? | Play | Living: `living/:kind`, `PATCH living/:kind` (Keep in Spotify, Freeze), `living/:kind/refresh`, `living/:kind/refreshes/:id`, `DELETE living/:kind` (rules). Weekly picks adds `picks`, `picks/weeks`, `picks/:id`, picks run, `blocks`; New from your artists adds `radar`, `radar/seen`. Set (`set-N`): `sets/:id`, `sets/:id/constraints`, `sets/:id/playlist`, `sets/:id/play`, `sets/:id/items/:position`, `DELETE sets/:id`, `dj`, `dj/stop` | Built |
| Build from rules `/playlists/new`, `/playlists/:id/edit` | Which of my songs should this playlist hold? | Create (Save when editing) | `living/preview` (live, 400 ms after a change), `POST living`, `PUT living/:kind` | Built |
| Ask `/ask` | Answer a question about my listening | Ask | `ask/threads`, `ask/threads/:id`, `ask/threads/:id` (DELETE), ask run (stream). Not in the sidebar; reached from the chat panel's Expand and History. Without AI it redirects to Home | Built |
| Chat panel (shell) | Ask, make a set or plan a cleanup without leaving the page, about the page | Send | the ask, set and library conversation runs with `context` (docs/api.md, Page context), `ask/threads`, `sets`, `library/plans` (history) | Built |
| Recaps `/recaps` | Which periods have I lived through, and how did each compare? | Open a period (Write it on a period with no recap, when AI is set up) | `digests/timeline`, recap run (stream) | Built |
| Recap `/recaps/:kind/:key` | What changed in how I listen, and what was this week, month or year? | Write it (AI) or Show the figures, on a period with no recap | `digests/periods/:kind/:key`, `digests/latest/:kind`, `digests/:id`, `digests/periods/:kind/:key/playlist`, `digests/periods/:kind/:key/cover`, `living` (This year so far), `digests/:id/card`, `shares`, recap run (stream) | Built |
| Library: Overview `/library` | What state are my liked songs and playlists in? | Open the songs behind a figure | `library/analysis` | Built |
| Library: songs `/library/songs` | Which songs are behind this figure? | Make a plan from them | `library/songs` (paged), `library/plans` (POST) | Built |
| Library: Plans `/library/plans` | What is waiting for review, what did I apply, and what should Claude tidy? | Review a plan (Plan with Claude opens the chat panel in Clean up) | `library/plans`, `library/batches` (polled while one runs), `library/batches/:id/undo`, `library/plans/:id/restore`, conversation run (stream) | Built |
| Library: plan `/library/plans/:id` | What exactly would this plan change? | Apply | `library/plans/:id` (paged by status), `library/plans/:id/items`, `.../apply`, `.../dismiss`, `.../restore`, `library/batches`, `library/conversations/:id` and its run | Built |
| Library: Instructions `/library/instructions` | What does Claude plan on a schedule, and what is kept out of picks? | Add an instruction | `library/standing`, `blocks` | Built |
| Setup `/setup` | Is encore connected and fed? | Do the next missing step | `onboarding`, `spotify/authorize`, `import`, `settings` | Built |
| Settings `/settings/*` | How does encore run? | Save a change | `settings`, `settings/claude/verify`, `settings/discord/register`, `backups`, `export/plays`, `alerts`, `spotify/disconnect`, `spotify/poll`, `llm/spend`, `auth/logout`, passkey routes | Built |

Built surfaces are the reference implementations: Home (`surfaces/Home.tsx`), Plays (list-led), Patterns: When (chart-led). Music lists and the entity pages (`surfaces/Music.tsx`, `surfaces/entity/*`) follow Plays and Home's Most played.

Monthly charts that span a long quiet lead-in or a gap in the history start after the first 5% of the total when that cuts more than a year (`lib/leadIn.ts`), and say what they left out.

Outside the app, one page needs no session: a shared recap at `/s/:token`. It is server-rendered HTML with no script and no app shell (`src/share/html.ts`): the encore mark, the period, the headline, then the recap's sections in the app's phone order (main column, then side) with the same inline charts drawn in CSS (the dither tile as an SVG data URI). System fonts, the app's light and dark colour roles, one 680 px column with a 16 px gutter. Nothing on it links into the app or names the owner. Security model: [docs/sharing.md](docs/sharing.md).

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
| Picks | Playlists: Weekly picks |
| Releases | Playlists: New from your artists; artist pages show their releases |
| Sets, SetPage | Playlists (Sets), `/playlists/set-N` |
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

The owner found For you empty: only the strip of covers. The index now shows what each playlist holds; Home keeps the playlists as small rows.

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

### Home is stats first (November 2026)

The owner wanted Home to be a stats page first, with everything else less prominent, and the all-time chart back. Stats now fill the first screen; what to play next is one quieter band under them.

| Before | Now |
| --- | --- |
| This week, then Made for you, then the composer beside what is new, then Most played beside On this day | This week, All time, Most played; then one band: Made for you beside the composer and the latest recap |
| The all-time chart (left Home with the week view) | All time, under This week and laid out the same way: Hours, Plays, Listens drive one chart of every month (120 tall, 96 on a phone), On this day in the side column |
| On this day beside Most played | All time's side column, the long view's rows as Top this week is the short view's |
| Made for you: six covers, at most 144 wide | Six rows (cover 40, name, one line), two columns; on a phone two rows that scroll sideways |
| This week's picks: three picks with Claude's reason | The Weekly picks row's line ("5 new picks this week"); the picks with reasons are one tap away on Weekly picks and on For you |
| New releases: three unseen releases | The New from your artists row's line ("1 new release"); one tap to the releases |
| Latest recap, a titled section | One row under the composer: the headline, then the recap's title and when |
| Play on a cover, with a mouse | Each playlist's page and For you have Play |

### Home's long view follows a range (November 2026)

The owner asked for the period selector back on the all-time stats.

| Before | Now |
| --- | --- |
| All time: Hours, Plays, Listens and the chart of every month, fixed | The same block for any range, titled with it, All time by default; the figures show the change from the range before, the chart's points follow the range's length |
| Most played, its own section with its own range picker and an hours-and-plays line | Part of the same block, under the chart; one range picker for the whole block |

### One chat panel (November 2026)

Every conversation with Claude was its own panel on its own page (Ask, the set page, Library plans). Now there is one chat panel in the shell that knows the page it is opened over.

| Before | Now |
| --- | --- |
| Ask: a page with its own composer and thread | The chat panel in Ask mode; `/ask` is the same conversation at full width with every question beside it (Expand and Open in panel move between them) |
| Sets: a composer on the Sets page | Make a set in the header opens the panel in Make a set mode |
| Set page: the docked "Change the set" panel (a bottom sheet on a phone) | Change (Answer while Claude's question waits, Changing… while a run goes) opens the panel on that set |
| Library Plans: an Ask Claude section with its own composer | Plan with Claude opens the panel in Clean up mode; a plan made there shows as a result row linking to its page, where Apply stays |
| Plan page: the docked "Change the plan" panel | Change with Claude opens the panel on the plan's conversation |
| `/library/claude/:id` a page | Opens the panel on that conversation and goes to Plans |
| Home's composer and the palette's Ask sent `?q=` to Ask or Sets | They open the panel in the chosen mode and send the text |

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

### The revamp (November 2026, in progress)

The target the surfaces move to. Each change updates the sitemap, the surfaces table and the layout recipes above when it lands, and adds a row here saying where the old capability went. No capability is dropped.

```
Listening                      Spotify                       Foot
├── Home       /               ├── Playlists  /playlists     └── Settings /settings
├── Plays      /plays          │   ├── /playlists/:id            + Data (backup, export)
├── Music      /music          │   └── New: Describe it | Build from rules   + Alerts
│   └── + Podcasts             └── Library    /library
├── Patterns   /patterns
│   ├── When  Eras  Taste (+ decades, listening age)
│   ├── Discovery (new artists and songs, comebacks, loyalty)
│   ├── Records (streaks, bests, milestones)
│   └── Skips  Places
└── Recaps     /recaps (a timeline of periods)

Chat panel (⌘J) on every page, its history inside it; /ask is the panel expanded, not a sidebar item.
```

| Before | After |
| --- | --- |
| For you (six bands, each a different layout) and Sets (a list of one) | Done, see "Where For you, Sets and Ask went". Playlists: every playlist encore makes in one list (Made for you, Sets, Rules, From recaps as filters), each row the same: cover, name, how it fills, fresh and in-Spotify line, Play. New playlist offers Describe it (Claude, a set) or Build from rules. Every playlist page is one template: header, its prompt or rules (caps per artist and album, share of new songs, exclusions, frozen), songs with reasons, changes |
| Ask in the sidebar, a list beside the panel | Done: the chat panel only, with History; `/ask` stays as the expanded panel |
| Recaps opens the newest week | A timeline: years, their months, their weeks, each with its headline; the current period in progress first (landed) |
| A recap's Claude lines at the foot ("As written then") | Each section carries its own line; new sections for discovery, comebacks and records; a year compares with the year before (landed) |
| Claude named everywhere; "Claude is not set up" warnings on For you, Ask and the chat composer | AI is optional and any provider: copy says what a feature does, not which model. With no provider set, AI entry points are absent (no chat button, no Describe it, no Weekly picks row, recaps show their figures) and Settings › AI is the one place that offers setup; the palette has Set up AI |
| Home: this week, the long view | Adds one highlight line to This week: a streak, a record or a milestone, when there is one (landed) |
| Recaps (landed, November 2026): `/recaps` redirected to the newest recap; weeks and months could be recapped only once over; a recap page at the reading measure; "As written then" at the foot; Write the recap on a period with none, with an "AI not set up" notice | `/recaps` is the timeline (Recaps recipe); the week and month in progress can be recapped so far, like the year; the recap page uses the whole frame (Recap recipe); the text of a recap from before recaps were pages is a header action, Text written then; Write it only when AI is set up, otherwise Show the figures, with no notice. `/recaps/week`, `/recaps/month`, `/recaps/year` still open the newest ended period |

### Where For you, Sets and Ask went (November 2026)

Playlists replaces For you and Sets: every playlist encore makes is one row of the same shape in one list, and every playlist page is one template. Ask leaves the sidebar. Old URLs redirect on the client: `/for-you` to `/playlists`, `/for-you/:kind` (and `/for-you/picks`) to `/playlists/:kind`, `/sets` to `/playlists?show=sets`, `/sets/:id` to `/playlists/set-:id`. `/ask` and `/ask/:id` stay.

| Before | Now |
| --- | --- |
| For you in the sidebar (`G` `F`), Sets (`G` `S`), Ask (`G` `A`) | Playlists in the Spotify group (`G` `Y`); Recaps moved to Listening; Ask only through the chat panel |
| For you bands: cover, name, what it is, the fresh line with "in your Spotify", Play, first songs | Playlists rows: cover 64 (56 on a phone), name, how it fills, one fresh line (a problem, then what is new, then how fresh, "in your Spotify"), Play. The songs are one tap away on the page |
| Weekly picks band: three picks with reasons, or the run's state | The Weekly picks row leads Made for you with up to three picks and their reasons under it; the run and its state are on its page. With no AI the row is gone |
| New from your artists band: four releases | Its row's fresh line ("1 new release"); the releases with Mark seen and Mark all seen are on its page, above its songs |
| From your recaps, under the bands | The From recaps filter and group; each row opens its recap, Play plays it in Spotify |
| Sets page: every set, Make a set | The Sets filter and group; New playlist › Describe it opens the chat panel in Make a set mode. History's All sets opens the filter |
| Set page: Play as a session, Change (Answer, Changing…), Save to Spotify or Update playlist, Open playlist, Delete set, pin and remove songs, the session line | The playlist template: Play (from Spotify when saved and current, else its songs), Save to Spotify or Update playlist, Change (with AI), More: Play as a session, Open in Spotify, Delete set. Songs keep their reasons, pins and removal; the session line stays under the header |
| Constraints only through the chat | How it fills: the prompt, then Songs per artist, Songs per album, Songs new to you, Leave out artists (add, remove) and Leave out songs (remove), saved with `PATCH /api/sets/:id/constraints` |
| For you playlist page: Play, Keep in Spotify, Refresh now, Open in Spotify, the songs or what it would start with, Changes and each change's songs, the notices | The same on the template, plus How it fills (the rule in plain words, the next refresh or Frozen) and Freeze in More. Rule playlists add Edit rule and Delete playlist |
| (new) | Build from rules: source, filters, order, size, per-artist cap, keep earlier songs, refresh, with a live preview of what it would hold |
| Ask page and sidebar item | The chat panel's History (Ask, Make a set, Clean up); Expand opens `/ask` |
| "Claude is not set up" on For you, Ask and the composer | With no AI: no chat button, no ⌘J, no Describe it (New playlist goes to Build from rules), no Weekly picks row, no Change on sets; one Set up AI entry in the palette, and the Settings tab |

## 2. Tokens

All in `web/src/styles/tokens.css`. Components use the Tailwind names in the right column, never a literal colour, radius, shadow or size. Light is the default; `.dark` on `<html>` swaps the values (set before paint by `public/theme.js`).

### Colour roles

| Role | Tailwind | Use |
| --- | --- | --- |
| Shell | `bg-shell` | Window, sidebar, player bar |
| Page | `bg-page` | The inset content panel |
| Container | `bg-container` | Side panels (queue) |
| Card | `bg-card` | A faint grouping fill when spacing cannot group |
| Sunken | `bg-sunken` | Wells |
| Overlay | `bg-overlay` | Menus, popovers, dialogs, sheets |
| Standout | `bg-standout`, `text-on-standout`, `text-on-standout-secondary` | Tooltip, toast |
| Glass | `glass` (utility: `--surface-glass`, `--glass-filter`, `--surface-glass-solid`), `text-on-glass-secondary` | The phone dock only: tab bar, Chat button, mini player. See Phone dock |
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
- Shell: `--sidebar-w` 232, `--panel-w` 360 (the queue), `--chat-w` 400 (the chat panel), `--player-h` 72, `--tabbar-h` 60 (the phone tab bar and Chat button; 48 collapsed, `--tabbar-h-collapsed`), `--mini-player-h` 56, `--dock-gap` 8, `--page-max` 1200 (the page frame, gutter included), `--measure` 720 (the reading measure), `--inset` 8 (0 on phone).
- `--bottom-chrome` on `:root`: the height the shell pins to the foot of the screen, safe area included. Player bar on desktop; on a phone the dock as it stands, expanded (tab bar, plus the mini player while one shows) or collapsed; the keyboard's height while the software keyboard is up. Anything fixed to the bottom (toasts, sheets) sits above it. It lives on the root because overlays render in a portal outside the shell.
- `--dock-h` (phone): the dock's expanded height, safe area included; 0 while the keyboard is up. The page panel pads its foot by it, so the last row scrolls clear of the dock in either state (at the end the dock is always expanded).
- Radius: `rounded-xs` 4, `sm` 6, `md` 8 (controls, rows), `lg` 10, `xl` 12 (page panel), `2xl` 16 (dialogs), `full`.
- Shadows: `shadow-control`, `shadow-panel`, `shadow-overlay`, `shadow-modal`. Dark mode replaces drops with an inset hairline.
- Motion: `--dur-hover` 150, `--dur-swap` 200, `--dur-modal` 240, `--dur-move` 300; eases `ease-out`, `ease-(--ease-move)`, `ease-(--ease-drawer)`. Every animation has a reduced-motion branch (the global rule in `app.css` makes them instant). No bounce, no spring overshoot.

## 3. Icons

Phosphor, regular weight; `fill` only for the active nav item and the playing state. Import from `web/src/ui/icons.ts` (add a re-export there for a new glyph) and draw with `<Icon icon={…} size="sm|md|lg" />` (16/20/24 in an even box). Icons label actions and nav; never decoration, never in coloured tiles. An icon-only control is an `IconButton` with a `label`.

## 4. Layout recipes

- **Shell** (`app/Shell.tsx`). Desktop: `[sidebar | page panel | right slot]` over the player bar; the right slot holds the queue panel or the chat panel, never both: opening one closes the other. The chat opens from its button before Queue in the player bar, ⌘J, or the palette; its open state survives navigation and a reload. The sidebar lists Listening and Spotify, each under its name in `text-caption text-secondary`, then Setup while onboarding is open, Settings at its foot. The page panel is the scroll container (`useScrollElement()`). Phone: the page edge to edge, scrolling under the floating dock (Phone dock below); More and the now-playing sheet are bottom sheets; the chat is a full-screen sheet over the page and the dock, and the page under it is `inert` and hidden once the sheet has slid over it. A tab or a More link closes it.
- **Phone dock** (`app/PhoneNav.tsx`, `app/dock.ts`, `MiniPlayer` in `player/PlayerBar.tsx`). After the iOS 26 tab bar and Apple Music. It floats over the page, `--gutter` from the sides and on the home indicator's safe area (`--dock-bottom`: the bottom inset, at least `--gutter`). Left, one pill holds Home, Plays, Music and More, icon over label, all in `text-primary`; the current tab sits on a `bg-fill-active` capsule that slides between tabs (`--dur-swap`, ease-out) and takes the filled icon. More is current on any page reached from it (Patterns and its tabs, Recaps, Library, Settings, Ask). Right, the round Chat button (only with AI set up; without it the pill takes the full width), as tall as the pill, green while the chat is open (`aria-pressed`, `PRESSED` from `ui/Button`). While something plays, the mini player is a third pill above them, full width: cover 40, title, artist in `text-on-glass-secondary`, Play or Pause; tapping it opens the now-playing sheet. Scrolling the page down by 16 collapses the dock: the tab pill shrinks to a 48 circle with the current page's icon (its surface's icon on a More page), Chat to 48, and the mini player moves between them (cover 36, title only). Scrolling up by 16, or reaching the top or the end, expands it; so does tapping the collapsed tab. Motion is CSS transitions on size and position (`--dur-move`, `--ease-move`); reduced motion makes them instant. Hidden while the software keyboard is up.
- **Glass, the one exception.** The dock is the only translucent surface in encore: it floats over the page, and a blur of what scrolls under it keeps the page's place readable where an opaque pill would read as a hole. Everywhere else glass stays banned (Do and don't). `glass` paints `--surface-glass` (white or `#1f1f1f` at 80%) over `--glass-filter` (blur 16, saturate 150%), and falls back to the opaque `--surface-glass-solid` when `backdrop-filter` is unsupported or `prefers-reduced-transparency: reduce`. The 80% is the floor for contrast: over a black backdrop (light) or a white one (dark) `text-primary` and `text-on-glass-secondary` keep 4.5:1 and the green pressed Chat icon 3:1. Only those two text colours go on glass; `text-secondary` and `text-tertiary` do not.
- **Page frame** (`ui/Page.tsx`). One frame on every page: a column `--page-max` (1200) wide with the gutter (`--gutter` 32, phone 20) inside it, so content is 1136 wide, centred in the page panel (at 1280 and 1440 it fills the panel; at 1920 it sits centred with 240 on each side). A band at the top holds the breadcrumb trail: 48 tall on desktop and always reserved, so every title, tab strip and first content line starts on the frame's left edge at the same offset (title top 48 from the panel's top). Pages set no width of their own. The one exception is the reading measure: `Page width="read"` keeps the frame, header and tabs, and holds everything under the header to `--measure` (720), left-aligned on the frame edge. It is for forms and long reading text: Settings, a recap, Sets.
- **Breadcrumbs** (`ui/Breadcrumbs`, from `trailFor` in `app/nav.ts`). Only on a page below its surface: an entity, a playlist (a set too), Build from rules, a thread, a recap, a Library plan, the songs behind a Library figure, a Library conversation. The trail is the surface, then the tab that owns the page (`SurfaceTab.owns`: Music › Artists › Mac Miller), then the page's own name, not a link, `aria-current="page"`. A top-level page and a tab of one show no trail: the sidebar and the tab strip already say where you are, and a single crumb would repeat the title (Settings › Spotify is the Settings tab strip, not a trail). The page passes its name as `Page crumb`: undefined while it loads (a short skeleton bar in its place), null when it failed (the trail ends at the parent, which is still a link). Middle crumbs and the name truncate, with the full text in `title`. Phone: no trail, one "‹ Parent" link (44 tall) in the band; a top-level page has a 24 band and no link.
- **Page header** (`PageHeader`). `PageHeader title actions secondary` (+ `TabNav` as children for a surface with tabs) > sections 40px apart (48 from `md`; `SECTIONS` for a body under a shared header). Title left, actions on the same row at every width, right-aligned (bottom-aligned with the title on desktop, centred on its first line on a phone), at their full size: a long title wraps to two lines, then ends in an ellipsis. `secondary` actions sit before `actions` on desktop and fold into one More menu on a phone, so the row never holds more than the primary action and More. The range picker sits in the header actions of every ranged surface. An entity header puts its `aside` (the range picker) top right at every width, beside the artwork on a phone. One primary or accent button per surface: once a step is done, its repeat action (Connect again, import again) is secondary.
- **Patterns tab** (`surfaces/PatternsFrame.tsx`). Every Patterns tab renders through `PatternsFrame`: header, `TabNav`, range picker, first-use state. A tab only supplies its body.
- **Stat strip driving one chart.** At most three figures; the selected one draws the chart below it. Never a row of identical metric boxes.
- **Ranked list.** `RowList` of `TrackRow`/`ArtistRow`/`AlbumRow`: rank, art, title over subtitle, dither meter (when the list is 512px or wider), figure. Whole row is the link; songs get play and menu on hover, a context menu on right click. On desktop the actions overlay the figure (the figure hides while they show), so a row reserves no width for them; on a phone they sit in the row. Art: 32 in ranked lists and side columns (40 on a phone), 40 in rows with a second line of detail (skips, cleanup proposals, set songs, the queue), 48 in release and set lists, 64 for picks and the playlist list (the fixed cover). A set's art is its generated cover (`coverUrl`, the image saved as the playlist cover), in the set list and the set page header.
- **Log table.** Plays: virtualised rows grouped by day headings, columns that drop by width (`useColumns`), a phone row layout. Toolbar above, count line, then the table.
- **Entity page.** `EntityHeader` (artwork, title, credits, first and last play, Play plus secondary actions, range picker as `aside`) > stat strip driving the listening chart > main plus side column (ranked songs; albums, releases, versions) > skips in context, full width.
- **Main plus side column.** `SIDE_COLUMNS` (`lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]`): the main answer left, small related lists right.
- **Outside the shell** (`AuthPage` and `Card` in `surfaces/SignIn.tsx`). Sign-in and the MCP consent (`/connect/:id`, `surfaces/Connect.tsx`, where `/oauth/authorize` sends the browser): the lockup over one fixed-height card, the title, the body, then the footer (ghost on the left, primary on the right; stacked with the primary on top on a phone). Signed out, the same address shows sign-in first and the consent after it. The consent title names the client as it named itself; the line under it names the host it returns to, the one fact encore can check. Then what its tools can do, in two groups (Read your listening, Play songs in Spotify) with the tool names under each, and Deny and Allow. A client that returns to this computer (a loopback redirect) says so in that line instead.
- **Setting rows.** `SettingRows` separates rows with spacing only, no hairlines; a section heading groups them. A hairline is kept for selection or a table, never to divide settings.
- **Chat panel** (`chat/ChatPanel`, `chat/Chat`, state in `chat/ChatProvider`). One conversation for three jobs: Ask, Make a set and Clean up are modes of the same composer, picked in the composer's footer while the conversation is new (where Beautiful UI's Prompt Bar keeps its model picker). Frame, after Beautiful UI's Chat: a 48 header (56 on a phone, with a grabber) over a hairline with the conversation's name (its first question, the set's or plan's title, "New chat") and its actions, New chat, History, Expand (Ask, desktop) and Close; then the thread; then the composer at the foot, inset 12. Desktop it docks in the shell's right slot, `--chat-w` wide, `bg-container`, `rounded-xl`, `shadow-panel`, like the queue. On a phone it is a full-screen sheet over the page and the dock, padded by the top and bottom safe areas (no bottom pad while the keyboard is up, so the composer sits on it); a swipe down on its header (`touch-none`; past 120 or a flick) slides it away, Close does the same at once, and focus goes back to the Chat button. On `/ask` from `lg` the same frame is the pane beside the list of questions, `bg-card`, flush with the page panel's top, right and bottom edges; its header has Open in panel in place of Close and History. The page under it knows nothing of it: `usePageContext()` (`app/pageContext.ts`) reads the route (artist, album, song, playlist, recap period, Patterns view and range, Library and a plan, a set) and names it from data already in the query cache, so opening the panel fetches nothing. The context shows as one chip over the text, "About: Mac Miller", where Prompt Bar keeps its @ sources; removing it sends the message without it, and it comes back on the next page. Inside, top to bottom: the owner's message in a `bg-fill` bubble on the right; while a run goes, Thinking: the pixel loader (a 3 by 3 grid pulsing in `bg-primary`, 650 ms) with the shimmering label ("Answering", "Building your set", "Making a plan") and the elapsed time, over the steps as they run, a label and its detail in a `bg-fill` chip (the current one spins); done, the steps fold into "Worked for N s" with a caret that opens them (400 ms, `--ease-out`). Answers are `AnswerView` at panel width, with a caret while text streams. A stored answer has a More button on its Based on row ("Share this answer", `chat/ShareAnswer`): Download card, Download square card, then Public link…, a dialog with the card and `PublicLinks`. A set or plan the run made is one result row (a Task Row: cover 40 or none, title, "N songs · version V" or "N songs to review", a caret) that links to its page and closes the panel on a phone; approving a plan stays on the plan page. The composer carries the notices tied to a run (a failed run with Try again, Stopped, Claude not set up, the cap spent, Spotify paused for sets), the monthly spend in its footer inside a stored conversation, and Stop in place of send while a run goes. An empty conversation shows up to four starters over the composer, about the page first (`chat/starters.ts`); a starter sends at once, as a tap is the owner's action. History lists the job's conversations (Segmented: Ask, Make a set, Clean up), 12 rows, title and when, with All questions, sets or plans under them. `Conversation` keeps its behaviour: the thread follows a streaming run while the reader is at the end; scrolled up, Jump to latest appears over the composer. A run belongs to the server: closing the panel or leaving the page stops listening, not the run; Stop is the only cancel. Motion is CSS only: messages and starters fade up (300 to 350 ms, starters 90 ms apart), the sheet slides up (`--dur-modal`, `--ease-drawer`); reduced motion stops every loop.
- **Ask** (`surfaces/Ask.tsx`). Not in the sidebar. The chat panel's conversation in Ask mode at full width. From `lg`: `[340 | pane]`, the page frame's band, title and New question over Your questions on the left, the chat frame as the pane on the right. Narrower: the title, then the conversation as the page with Your questions over the composer while it is empty. Delete question is a `secondary` header action with a confirm.
- **Playlist page, Plans, plan page.** Each keeps its page; none holds a conversation. A set's page has Change (Answer, Changing…) in its actions; Plans has Plan with Claude on To review; a Claude plan's page has Change with Claude. Each opens the chat panel in its mode or on its thread.
- **Home** (`surfaces/Home.tsx`). Stats first, then one quieter band. This week (`SIDE_COLUMNS`: the hours so far as the figure, a line with `InlinePair` and `InlineChange` against the usual, then the week's highlight when there is one (`stats/highlight`: an all-time record set this week, else the biggest milestone passed, else a run of 7 days or more; one sentence in `text-primary`, shown only once loaded, nothing on a failed load), the last 30 days as `DitherBars` | Top this week, artist and song rows) > the long view for one range, laid out like the short one and titled with the range ("All time", the default; "Last 30 days", "2025"), the range picker in its actions and nowhere else on Home (`SIDE_COLUMNS`: `StatStrip` of Hours, Plays, Listens with the change from the range of the same length before, when the range has one, driving a `DitherArea` of the range, a day, week or month per point by its length (`periodFor`), 120 tall, 96 on a phone | On this day, a row per earlier year), then Most played under it, full width (Artists, Songs, Albums tabs, Show all; a range with no plays shows one empty state for the whole group) > the band, `SIDE_COLUMNS`: Made for you (title in `text-secondary`, Open Playlists; the built-ins only, Weekly picks only with AI; a row per playlist, cover 40, name and its freshness line, two columns; on a phone two rows that scroll sideways with snap) | Latest recap (title in `text-secondary`, then the headline, title and when; only when there is one). No composer: questions and sets go to the chat panel, always one tap away. The band has no figures, no charts and no cover over 40, so the stats keep the weight. What is new for the picks and the releases is the line of their playlist's row. This week: "this week" is the recap week that holds today (weeks end the day before the recap weekday); "usual" is the mean of the same stretch, to the same local hour, of the four weeks before that the history covers whole. With none, the figure stands alone with its play count; with nothing played yet it says so and what is usual by now. Each block fails on its own with Try again; On this day hides when there is no earlier year. Nothing on Home starts a run or playback by itself.
- **Patterns: Discovery** (`surfaces/Discovery.tsx`). `StatStrip` of New artists, New songs and On new songs (the share of hours on songs first heard that month) driving `DitherBars` by month, with an `InlineFact` for the month with the most; the history's first month is left out (everything in it is new) and a long quiet lead-in is cut and said. Then New in (the month, a `Select` of months with finds, newest first): songs and artists first played that month by hours that month, two columns from `xl`. Then `SIDE_COLUMNS`: Loyal artists (a row per artist with a strip of one cell per year with music in the range, solid green for a year with 2 h or more of them, the run in words, and the count of years) | Comebacks (back after six months or more away: when, after how long, hours since). Definitions in docs/api.md.
- **Patterns: Records** (`surfaces/Records.tsx`). The current run of days with music as the one figure (the longest in the range when there is no current one, the longest beside it when longer). `SIDE_COLUMNS`: Bests, a list of label, figure, detail (day, week, month, session, one song in a day; the session rule in the description) over Milestones, newest first, the threshold as the row's figure | Longest runs by artist. No chart: each record is one fact.
- **Taste: Release decades** (in `surfaces/Taste.tsx`, after energy, shown even with no tags). An `InlineFact` with the listening age and its formula in words (the median release year, weighted by time listened), `DitherBars` of each decade's share of dated listening, and the coverage line when release dates cover under 98% of the range's hours.
- **Music: Podcasts** (`surfaces/Podcasts.tsx`). One line of totals, then `SIDE_COLUMNS`: Shows by hours (ranked rows with meters, the microphone glyph as art: shows have no page) | Latest episodes. Episodes do not count anywhere else in encore.
- **Playlist rows on Home** (`PlaylistRows` in `surfaces/playlists/shared.tsx`). The built-ins, small: the generated cover at 40, the name, one freshness line (`freshLine`: a problem first in `text-danger`, then what is new in `text-primary`, then how fresh it is). The row is one link to the playlist's page, where Play is. Open Playlists in the band's header.
- **Playlists** (`surfaces/playlists/List.tsx`). Header: title, New playlist (primary; with AI a menu, Describe it and Build from rules; without, a link to Build from rules). Under it the filter strip (`TabList`: All, Made for you, Sets, Rules, From recaps; Sets only with AI or when sets exist; `?show=`), the Spotify gate notice once, then the rows. All groups them under section titles (Made for you, Your rules, Sets, From your recaps), empty groups hidden; a filter shows one group without its title. Every row is one shape: cover 64 (56 on a phone), name (the link; its `::after` covers the row), how it fills in `text-secondary` (`BUILTIN_FILL`, "Rule: …" from `ruleSummary`, "Made from a prompt", "Saved from its recap" or "Kept when 2025 ended"; two lines on a phone), one fresh line in `text-caption`, a round Play at the right when there is anything to play. Weekly picks leads, with up to three `PickPreviews` under it (indented to the text on desktop). Empty filter: an `EmptyState` with the action that fills it (Build from rules, Describe it, Open Recaps).
- **Playlist page** (`surfaces/playlists/PlaylistPage.tsx`: `LivingPage` for a built-in or rule, `SetPage` for `set-N`). `EntityHeader`: cover, title, about, the fresh line (`text-danger` for a problem), actions: Play (accent), then per kind Keep in Spotify (switch) and Refresh now, or Save to Spotify or Update playlist and Change; the rest in More (Refresh now on a phone, Edit rule, Freeze or Unfreeze, Play as a session, Open in Spotify, Delete, after a separator). Then the gate and state notices, then `SIDE_COLUMNS`: How it fills (a built-in's or rule's rule in plain words from `describeRule`, one sentence a line, with the next refresh or Frozen in `text-secondary`, Edit rule in the section actions for a rule; a set's prompt and its limits as `SettingRow`s with Save limits once changed), then the songs (Weekly picks: `WeeklyPicks`; New from your artists: `ReleasesSection` above them; a set: rows with reasons), and Changes in the side column.
- **Build from rules** (`surfaces/playlists/RuleBuilder.tsx`, the fields in `rules.ts`: `fromRule`, `toRule`). `SIDE_COLUMNS`: the form left in `SettingRow`s under three sections (Where the songs come from, Only songs that, Order and size), Create (or Save) and Cancel at its foot; It would hold right, sticky on desktop and after the form on a phone: the count and the first 20 songs from `POST /api/living/preview`, read 400 ms after the last change, dimmed while a newer one loads. A field's problem shows in place of its hint; the name's only after the first Create.
- **Plan review** (`surfaces/library/PlanPage`). Header with Apply (primary, names the count) and Dismiss as a `secondary` action (a More menu on a phone). Under it the apply as the server reports it (`BatchStatus`: progress while running, what was and was not applied, skipped songs with their reasons, Undo); it never says failed while a batch runs. Songs are grouped by action and place: a group heading with a tick for the whole group and Archive or Remove, then rows with a tick, art 40, the reason, and a menu (switch, Dismiss). Status tabs (To review, Applied, Skipped, Dismissed) show only when they hold songs. A Claude plan's conversation is in the chat panel: "Change with Claude", a `secondary` header action ("Changing…" while a run goes), opens it on the plan's thread. `/library/claude/:id` opens the panel on that conversation and goes to Plans. The Apply confirm states each consequence, including the new date added for liked songs taken out.
- **Recaps** (`surfaces/Recaps.tsx`, `recaps/Timeline.tsx`, `/recaps`). A timeline in the page frame, no boxes: the week and the month still going ("This week so far", "November so far") and the weeks that ended in that month, then each year newest first, its months under it, each month's weeks under the month. Hierarchy is type and spacing: a year's name in `text-figure` display, a month's in `text-heading`, a week's in `text-body-sm` secondary, indented 24 on desktop. Every row is one link to its recap and carries the same four things: the period, the headline (the written one, else "Mostly <top artist>" from the figures, else "No recap yet" or "No listening" in `text-tertiary`), the hours as `InlinePair` against the same stretch of the period before and the figure, and the change (`InlineChange`; under the figure on a phone). With AI set up a period with no recap has Write it (ghost, small) after its line, shown on hover with a mouse and always on touch; one write runs at a time. The two newest years are open; older ones show their row and Show N months. Hours come from the plays today, so a recap written before plays were deleted can differ.
- **Recap** (`surfaces/Recaps.tsx`, `recaps/Sections.tsx`, `/recaps/:week|month|year/:key`). A page below Recaps in the whole frame: the trail is Recaps › the period ("Recaps › October 2026"), the title is the period ("November 2026 so far" while it runs), Share and, for a recap from before recaps were pages, Text written then (a dialog with that text) are `secondary` header actions (a More menu on a phone). Under the title row, Week, Month and Year (`Segmented`) then the arrows to the period before and after; the arrows carry no label, since the title already names the period. Then the headline (`text-display`, held to `--measure`), one line of when and what it is compared with, the note when there is nothing to compare with, and Write it (AI, a recap with figures only) or Bring up to date (a period still going, days behind). Then two columns from `lg` (`[1fr | 320]`, gap 64): the main column, held to `--measure`, answers how much and what: Listening (the figure, the comparison, each day), Against <year before> (a year only, from `stats/years`: plays, new artists and new songs with the change, when the year has ended; the top artists with their place the year before; genre and mood shares with a tick where they stood), Month by month (a year), Artists (top five, then who rose and fell; in a year with Against, only "Rising and falling"), Songs of the period with Play and Save to Spotify in the section's actions. The side column holds the lists: New to you (the share of time on songs first heard in the period, then the songs and artists that came back on another day), Back again (comebacks, five then Show all), Records (all-time records set in the period as `InlineFact`s, then Milestones, five then Show all), Genres and moods (not in a year with Against), When (busiest day and hour, the longest run of days with music when it is 3 or more). On a phone the side follows the main. Each section shows its written line under its title when there is one; a section with nothing to show is left out, so recaps stored before a section existed simply lack it. `/recaps/:length` opens the newest ended period; `/recaps/:id` (old links) redirects to its period. A period with no recap: "No recap of <period> yet", with Write it (AI) or Show the figures (no AI; stores the figures alone).
- **Start a session.** `StartSessionButton` (secondary, small) sits beside a list of songs worth a session (Home top songs, Forgotten, an era, keepers in Skips, a trip). It opens the queue panel, where the session runs.

### Phone and touch

The platform layer lives in `styles/app.css`, `styles/tokens.css`, `app/Shell.tsx` and `app/keyboard.ts`; a surface does not repeat it.

- **A toggle that is on is green.** A ghost button with `aria-pressed="true"` (Shuffle, Queue) takes `text-accent-text`, set once in `ui/Button.tsx`; never colour a pressed button by hand.
- **Hover only with a mouse.** `hover:` and `group-hover:` apply under `(hover: hover) and (pointer: fine)`. On a touch screen `hover:` styles show while pressed (`:active`), so every control answers a press within `--dur-hover`. Hand-written hover CSS goes in the same query. Actions revealed on hover hide only under `can-hover:`; on a touch screen they always show, in the row.
- **Press, not release.** `press` (scale 0.97) on buttons and tabs; no feedback that waits for `click`. No tap highlight (`-webkit-tap-highlight-color: transparent` on the root).
- **Controls are not text.** Buttons, tabs, menu items, options, switches, checkboxes and nav links take `user-select: none` and `-webkit-touch-callout: none`. Content (names, figures, errors, links in text) stays selectable. Controls and fields take `touch-action: manipulation`.
- **Fields are 16px on a touch screen** (an unlayered rule beats the `text-*` utilities), so iOS never zooms. Never `maximum-scale` or `user-scalable=no`. Set the keyboard: `enterKeyHint` (send, search, go), `autoCapitalize="none"` and `autoCorrect="off"` on search and name fields.
- **Heights.** The shell is `100dvh`. While the software keyboard is up on a phone, the shell fits the visible area above it, the dock hides, and `--bottom-chrome` becomes the keyboard's height (`app/keyboard.ts`; iOS pans the page under the keyboard otherwise). A pinned composer stays on the keyboard; a thread at its end stays at its end.
- **Scroll.** The root does not bounce or pull to refresh (`overscroll-behavior: none`); the page panel, sheets, popups, the palette list and tab strips contain their own scroll (`overscroll-contain`, `overscroll-x-contain`). Never a `touchmove` listener to stop scrolling.
- **Safe areas.** `viewport-fit=cover`. The page pads the top and sides, the dock sits on the bottom inset and the side insets, the desktop grid pads the sides and bottom, sheets (the chat sheet too) pad the bottom, toasts keep 16px from the side insets. Use `env(safe-area-inset-*, 0px)` inside `calc()`.
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
| `PublicLinks` | `ui/PublicLinks` | Public links to a frozen copy (`target`: a recap, or an answer by thread and turn): expiry and Make link, the URL once in a `CopyField`, active links with Revoke and its confirm. In the recap's Share dialog and an answer's Public link dialog |
| `Notice` | `ui/Notice` | The one notice: gates, paused calls, failed runs, save effects. One sentence that changes what the user does next: `tone` info, warning, danger; `action`; `onRetry` adds Try again. Full bleed on a phone |
| `DropZone` | `ui/DropZone` | `onFiles`, `accept`, `multiple`, `title`, `description`, `button`. Unpainted until a drag is over it |
| `Segmented` | `ui/Segmented` | Two to four views of the same data: `value`, `onChange`, `options`, `label`. Full width on a phone |
| `TabsRoot`, `TabList`, `TabPanel` | `ui/Segmented` | In-page tabs with an underline |
| `TabNav` | `ui/TabNav` | Route tabs under a page header: `items`, `label` |
| `MenuRoot`, `MenuTrigger`, `MoreTrigger`, `MenuPopup`, `MenuItem`, `MenuLinkItem`, `MenuSeparator`, `MenuLabel` | `ui/Menu` | Item: `icon`, `danger`, `hint`. MoreTrigger: the dots button, `label` ("More for Woods"), `size` sm or md |
| `Dialog`, `DialogClose`, `Confirm` | `ui/Dialog` | Dialog: `open`, `onOpenChange`, `title`, `description`, `footer`, `width` 440, 560, 720 (bottom sheet on phone). Confirm: `action`, `danger`, `busy`, `onConfirm`. Prefer undo over confirm |
| `PopoverRoot`, `PopoverTrigger`, `PopoverPopup` | `ui/Popover` | `align` |
| `Tooltip` | `ui/Tooltip` | `label`, `side`. Never the only place information lives |
| `showToast`, `Toaster` | `lib/toast`, `ui/Toast` | `showToast(message, "info" | "problem", { label, onClick })`. One at a time: a new toast replaces the one showing. Info closes after 4 s, a toast with an action (Undo) after 8 s, a problem stays until dismissed. Hover, focus or a finger on it pauses the timer; a touch elsewhere resumes it. Close button, Escape, or a swipe down or sideways dismisses it. It sits 12px above `--bottom-chrome`, never over the dock or the player bar, and follows the dock as it collapses and expands |
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
| `AnswerView`, `answerFromText` | `ui/Answer` | `answer`, `streaming` (a caret after the last text). A structured answer from Claude (`Answer` in `api/types`): paragraphs with inline visuals, block visuals between them on the conversation's surface (no card), a dotted `text-warning` underline under a number no tool returned with one caption line saying so, and Based on folded away. `answerFromText(text, visuals)` splits streaming text, or an answer written before answers were structured, the same way the server does: a block whose visual has not arrived holds its place as a skeleton, a half-written marker is hidden. Not tied to Ask |
| `InlineVisual`, `BlockVisual` | `ui/AnswerVisual` | One answer visual. Inline: `pair` (`InlinePair` and `InlineChange`), `share` (`InlineShare`), `series` (`InlineColumns`, the peak marked). Block: `ranked` (title, then `Row`s: songs play and open their page, artists and albums open theirs; meters from `@lg`), `series` (`DitherBars`, 160 tall, its data table), `compare` (labels, `PairMeter` from `@md`, now and before figures under the two labels, its data table). A block with nothing in it says "Nothing in this period." under its title |
| `RunProgress` | `ui/RunProgress` | `run` (from `useRun`), `title`, `onCancel` (omit in a `Conversation`: the composer's Stop cancels) |
| `Composer`, `ComposerChip` | `ui/Composer` | The prompt bar, after Beautiful UI's Prompt Bar: `value`, `onChange`, `onSubmit`, `onStop`, `running`, `label`, `notice`, `footer` (the mode picker or the spend), `chips` (over the text), `inputRef`. Send and Stop are one 28 square (44 hit area on a phone). ComposerChip: `label`, `value`, `onRemove` |
| `Conversation` | `ui/Conversation` | The thread inside: `messages` (null while empty), `composer` (the composer with its notices), `empty` (starters: under the composer while empty, over it when `contained`), `follow` (changes when a message is added), `startAtEnd`, `thread`, `contained` (own scroll box, fills the parent's height, composer at the foot), `inset` (pads off a surface) |
| `ChatProvider`, `useChat` | `chat/ChatProvider`, `chat/state` | The one conversation's state: `open`, `mode`, `thread`, `context` and `removeContext`, `draft`, `pending`, `run`, `gate`; `show({ thread, mode, send, open })`, `send`, `stop`, `close`, `toggle`, `expand`, `collapse`, `runningFor(thread)` |
| `ChatPanel` | `chat/ChatPanel` | `place` dock, sheet (phone) or pane (`/ask`) |
| `Chat` | `chat/Chat` | The conversation with its composer: `variant` panel or page, `empty` (under the starters) |
| `Thinking` | `chat/parts/Thinking` | A run's progress and its steps, folded to "Worked for N s" when done: `running`, `label`, `steps`, `startedAt`, `seconds` |
| `HistoryList` | `chat/parts/History` | `mode`, `active`, `limit`, `onPick` (the panel) or `hrefFor` (the Ask page) |
| `usePageContext`, `routeContext`, `contextLabel` | `app/pageContext` | What the page is about, from the route and the query cache: the chip and the `context` sent with a message |
| `useClaudeGate` | `ui/ClaudeNotice` | Gate: `needsSpotify`; returns `ready`, `blocked` (no API key, monthly cap spent: disable the run and show it as the composer `notice`), `warning` (Spotify paused, shown as a `Notice`), `spend` (composer `footer`) |
| `StartSessionButton` | `ui/StartSessionButton` | Starts a DJ session and opens the queue panel |
| `BlockedList` | `surfaces/BlockedList` | Songs and artists kept out of picks and sets, with Allow. Picks and Library |
| `Kbd`, `MOD_KEY` | `ui/Kbd` | Hidden on touch screens |
| `Icon` | `ui/Icon` | `icon`, `size`, `fill` |
| `EncoreMark`, `Lockup` | `ui/Brand` | Mark at 16, 32 or 48 only, in `text-accent-text` (Spotify green on dark, the deeper green on light, where Spotify green is 1.7:1 on the shell). The wordmark stays `text-primary`. Lockup 16 or 32: the wordmark's box is trimmed to its x-height band (`text-box: trim-both ex alphabetic`; "encore" has no ascenders or descenders) and centred on the mark's centre, measured equal at both sizes (sidebar 16, sign-in 32, in `/dev/kit`). `public/favicon.svg` and `logo.svg` follow the colour scheme the same way; the PNG app icons draw the mark in Spotify green on near-black |
| `AppLink`, `useRangeHref` | `ui/AppLink` | A link that keeps the current range |
| Paths | `app/paths` | `artistPath(name)`, `songPath(key)`, `albumPath(artist, album)` |

Text greys pass 4.5:1 where they are used: light `--text-secondary` #5e5e5e (5.3:1 on a control fill over the shell), `--text-tertiary` #6f6f6f light (5:1 on the page) and #888888 dark (5.3:1 on the page).

`/dev/kit` (dev builds only) shows every primitive in its states. Fixtures: add `?fixture=loading|error|empty|new|worst|untagged|off`, `?player=playing`, `?dj=active` or `?run=running|starting|done|failed|budget|unconfigured|paused` (Claude runs answered by the fixture, never the server), `?history=before|none|slow|failed|env` (Settings, Ignore plays before; answered by the fixture, nothing deleted), `?living=connected|first|fresh|deferred|failed|empty|removed|scope|refreshing|kept|rules` (Playlists and its pages; `rules`: two rule playlists, one frozen and in Spotify with a long name; `kept`: every playlist on and in Spotify; switches and refreshes answered by the fixture, nothing sent to Spotify), `?library=apply|running|done|partial|failed|undoing|undofailed|undone|disconnected|unsynced` (Library apply and undo states; Apply and Undo answered by the fixture, no Spotify call), `?ask=empty` (Ask: every chart in a stored answer with nothing in it), `?ask=visuals` (Ask: the newest stored answer with an inline pair and a ranked block), `?sets=constraints` (the newest set with every limit set; saving answered by the fixture; `?fixture=worst` also gives a recap 50 comebacks and the longest names in every list), `?picks=none` (this week has no picks yet), `?playlists=saved` (Playlists, From recaps: three period playlists, one without a cover), `?week=quiet|first` (Home, This week: nothing played yet this week; no earlier weeks to compare with), `?fail=stats/timeseries,living` (every GET under each listed `/api/` path answers 500, the rest stay real: one block's failed load), `?recap=none|facts|first|quiet|spotify|saved` (Recaps: real periods bent to no recap yet, no Claude lines, history starting inside the period, almost no listening, Spotify connected, the playlist already saved; saving answered by the fixture) to any dev URL (`web/src/dev/fixtures.ts`); the choice sticks for the tab until `off`, `?highlight=record|session|song|milestone|streak|none` (Home.

The chat parts in `web/src/chat/parts`, the composer and the streaming caret are adapted from Beautiful UI (MIT, `web/src/chat/parts/LICENSE`): anatomy, spacing and timings kept, restyled with these tokens, UI SDK and Phosphor.

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
| `PairMeter` | `charts/PairMeter` | Now over before as two row-sized bars on the list's shared scale (dithered now, grey before). Beside printed figures, in an answer's compare rows; hidden from assistive tech, the rows' data table carries the values |
| `InlineFact` | `charts/Inline` | One fact that is a figure, on one line: what it is (`text-secondary`), its small chart (`InlineColumns` with the peak lit, `InlineShare`), the figure (medium, `tabular`), then what it names. "Busiest hour ▁▂█▃ 25 h Wednesdays, 07:00 to 08:00" on Patterns: When (that weekday hour by hour); Busiest day and Busiest hour on a recap (each day of the period, a week per column in a year; 24 hours); Top genre or mood on Taste (its share of tagged listening). The words carry the fact for a screen reader. A sentence that explains rather than counts, or that describes the chart right under it (Longest era, energy through the day, devices, skips by context, trips), stays text |
| `ArtChip` | `charts/Inline` | 20 px artwork beside a name, clamped to one line. The name is the label; the image is decoration |
| `ditherTile(level)`, `levelFor(share)` | `charts/ditherTile` | The halftone as a CSS background for anything that is not a canvas |
| `DataTable` | `charts/DataTable` | The table behind every chart: read in place by screen readers, opened by everyone else from a table icon under the chart |

Inline charts are sized for a line of text and sit next to the figure they draw, never in place of it. Each takes a `label`: the sentence a screen reader hears instead of the picture ("42 h, against 30 h in October"). Recaps and Ask answers use them. `/dev/kit` shows each one, and the answer visuals in a sample answer.

Rules: a chart answers one question and has a printed figure or sentence that states the answer (an `InlineFact`: "Busiest hour ▁▂█▃ 25 h Wednesdays, 07:00 to 08:00"). Axis labels in `text-caption text-tertiary`. Every chart has a `DataTable`. Hover tooltips repeat data, they never hold it alone.

**Data table** (`DataTable`, under every chart). The chart's numbers as a real table, for keyboard and screen reader users and anyone who wants the exact figures. A quiet icon button (table glyph, ghost, small, tooltip "Show data") sits at the chart's right edge under the plot, or at the right of the legend row (When, Eras); it opens a dialog titled with the chart's label, a bottom sheet on a phone. The table scrolls inside it, 384 tall at most, under a sticky header with the first column sticky too; labels left, figures right-aligned in `tabular`; figures are plain numbers and the unit is named once in the column header ("Hours", "Hip-hop (%)", "October (h)"). The same table sits visually hidden in the figure, so a screen reader reads it in place. Nothing expands inline and the page never moves. Reference: Plausible Analytics' details dialog (Mobbin 04edaa49).

**Tooltip** (`components/dither-kit/tooltip.tsx`, every dither chart). The popover surface, as menus and popovers: `bg-overlay`, `shadow-overlay` (its hairline in dark), `rounded-lg`. It sizes to its content: the period in `text-secondary`, then one row per series (swatch, label, value in `text-primary`, `tabular`). A value and its unit never wrap; a long series label truncates. It sits above the highest point under the pointer, centred on it and pushed in at either edge, so it never leaves the chart. Touch: a tap shows it and it stays after the finger lifts, until the next touch outside the chart; a sideways drag scrubs; a vertical drag scrolls the page and hides it.

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
| Accent only for play, selection and chart emphasis | Green for "positive"; gradients, glows; glass anywhere but the phone dock |
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
