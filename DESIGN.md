# encore design

The contract for every screen in `web/`. Section 1 is the information architecture; the rest is how a surface is built. When this file and a screen disagree, the screen is wrong.

## 1. Information architecture

encore answers three jobs: **what have I been listening to**, **what should I play next**, and **keep my Spotify tidy**. Every surface belongs to one job and answers one question.

### Sitemap

```
Listening                      Play                        Secondary            Foot
├── Overview          /        ├── For you    /for-you     ├── Recaps  /recaps  └── Settings /settings
├── Plays             /plays   │   ├── Picks     /picks     │   └── /recaps/:kind/:key ├── general
├── Music             /music   │   ├── Releases  /releases  ├── Library /library        ├── spotify
│   ├── Artists   /artists     │   └── Playlists /playlists └── Setup   /setup          ├── claude
│   ├── Albums    /albums      │       └── /playlists/:kind                             ├── integrations
│   ├── Songs     /songs       ├── Sets       /sets                                     ├── jobs
│   ├── Forgotten /forgotten   │   └── /sets/:id                                        └── account
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
```

The source of truth for paths, labels, icons and shortcuts is `web/src/app/nav.ts`. The desktop sidebar shows every surface in its three groups (Listening, Play, Secondary) with Settings at the foot; there is no More menu. Setup leaves the sidebar once onboarding is complete (read from `/api/onboarding`, hidden until it loads), unless it is the open page; Settings (Open setup) and the palette still reach it. Phone tabs are the four Listening surfaces plus More, a sheet with search and the Play, Secondary and Foot surfaces.

### Surfaces

| Surface | Answers | Primary action | API | Status |
| --- | --- | --- | --- | --- |
| Overview `/` | How much did I listen in this range, to what, and what is waiting for me? | Change the range | `stats/overview` (range and the range before), `stats/timeseries`, `stats/top/*`, `stats/on-this-day`, `picks`, `radar`, `digests`, `status` | Built |
| Plays `/plays` | What exactly did I play, when, where? | Search and filter the log | `history` (paged, `q`, `skipped`, `device`, `source`, `artist`, `songKey`), `status`, `stats/overview` (first use) | Built |
| Music `/music/*` | Who and what do I play most, and which favourites did I drop? | Open an artist, album or song | `stats/top/*` (paged, `sort`, `q`), `stats/forgotten`, `stats/overview` (counts) | Built |
| Artist, album, song pages | Everything about one artist, album or song | Play it | `entities/artist`, `entities/album`, `entities/track`, `notes` (liner notes), `radar` (artist releases) | Built |
| Patterns: When | When in the week do I listen? | Pick a weekday and hour to see what fills it | `stats/clock`, `stats/top/tracks` and `top/artists` with `weekday` and `hour` | Built |
| Patterns: Eras | Which artists defined which months? | Pick an era | `stats/eras`, `entities/artist` and `stats/top/artists` for the picked month | Built |
| Patterns: Taste | Which genres, moods and energy over time? | Switch genres and moods | tag stats (`stats/tags/*`), `stats/timeseries`, `tags/pending` | Built |
| Patterns: Skips | Where do songs get skipped, and in what context? | Pick a moment class | `stats/skips` (with `positions` and `profile`), `stats/skips/split` | Built |
| Patterns: Places | Where and on what do I listen (trips, devices)? | Pick a trip | `stats/trips`, `stats/devices` | Built |
| For you: Picks | What did Claude pick for me this week? | Play the picks | `picks`, `picks/weeks`, picks run (stream), `blocks` | Built |
| For you: Releases | What did artists I play release? | Mark seen, play | `radar`, `radar/seen` | Built |
| For you: Playlists | Which encore playlists live in my Spotify account, and what is in them? | Switch a playlist on | `living`, `living/:kind`, `living/:kind/refresh`, `living/:kind/refreshes/:id`, `living/:kind/cover` | Built |
| Sets `/sets` | Make me a playlist from a prompt | Make a set | `sets`, `sets/:id`, set run (stream), `dj/start`, `dj`, `dj/stop` | Built |
| Ask `/ask` | Answer a question about my listening | Ask | `ask/threads`, `ask/threads/:id`, ask run (stream) | Built |
| Recaps `/recaps` | What changed in how I listen, and what was this week, month or year? | Write the recap of a period that has none | `digests`, `digests/periods/:kind/:key`, `digests/latest/:kind`, `digests/:id`, recap run (stream) | Built |
| Library `/library` | What in my saved songs and playlists should go? | Review proposals | `cleanup`, `cleanup/dismiss`, `cleanup/apply`, `cleanup/batches`, `cleanup/batches/:id/undo`, `blocks` | Built |
| Setup `/setup` | Is encore connected and fed? | Do the next missing step | `onboarding`, `spotify/authorize`, `import`, `settings` | Built |
| Settings `/settings/*` | How does encore run? | Save a change | `settings`, `settings/claude/verify`, `settings/discord/register`, `spotify/disconnect`, `spotify/poll`, `llm/spend`, `auth/logout`, passkey routes | Built |

Built surfaces are the reference implementations: Overview (home), Plays (list-led), Patterns: When (chart-led). Music lists and the entity pages (`surfaces/Music.tsx`, `surfaces/entity/*`) follow Plays and Overview.

Monthly charts that span a long quiet lead-in or a gap in the history start after the first 5% of the total when that cuts more than a year (`lib/leadIn.ts`), and say what they left out.

### Where every old screen went

| Old screen (`git show main:web/src/screens/<File>.tsx`) | New home |
| --- | --- |
| Overview | Overview (figures and chart), Music (full rankings), Recaps/For you (the "waiting for you" column) |
| History | Plays |
| Explore (search, browse top lists) | Command palette (search), Music tabs (browse) |
| Entity (artist, album, song pages) | Music detail pages `/music/artist`, `/music/album`, `/music/song` |
| Forgotten | Music: Forgotten |
| Clock | Patterns: When |
| Eras | Patterns: Eras |
| Skips | Patterns: Skips |
| Trips | Patterns: Places (with devices) |
| Tag trends and energy (Eras/Overview panels) | Patterns: Taste |
| Picks | For you: Picks |
| Releases | For you: Releases; artist pages show their releases |
| Sets, SetPage | Sets, `/sets/:id` |
| Session (DJ session) | Queue panel (desktop) and now-playing sheet (phone): the session shows next to the queue it drives, with Stop |
| Ask | Ask |
| Digests | Recaps |
| Cleanup (incl. blocks) | Library |
| Settings (incl. onboarding parts) | Setup (first run and missing steps), Settings (everything that stays) |
| SignIn | Sign-in screen outside the shell (`surfaces/SignIn.tsx`) |

No capability was dropped. Old URLs are not redirected.

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
- Shell: `--sidebar-w` 232, `--panel-w` 360, `--player-h` 72, `--page-max` 1200, `--inset` 8 (0 on phone).
- Radius: `rounded-xs` 4, `sm` 6, `md` 8 (controls, rows), `lg` 10, `xl` 12 (page panel), `2xl` 16 (dialogs), `full`.
- Shadows: `shadow-control`, `shadow-panel`, `shadow-overlay`, `shadow-modal`. Dark mode replaces drops with an inset hairline.
- Motion: `--dur-hover` 150, `--dur-swap` 200, `--dur-modal` 240, `--dur-move` 300; eases `ease-out`, `ease-(--ease-move)`, `ease-(--ease-drawer)`. Every animation has a reduced-motion branch (the global rule in `app.css` makes them instant). No bounce, no spring overshoot.

## 3. Icons

Phosphor, regular weight; `fill` only for the active nav item and the playing state. Import from `web/src/ui/icons.ts` (add a re-export there for a new glyph) and draw with `<Icon icon={…} size="sm|md|lg" />` (16/20/24 in an even box). Icons label actions and nav; never decoration, never in coloured tiles. An icon-only control is an `IconButton` with a `label`.

## 4. Layout recipes

- **Shell** (`app/Shell.tsx`). Desktop: `[sidebar | page panel | queue panel]` over the player bar; the sidebar lists every surface in three unlabelled groups, Settings at its foot. The page panel is the scroll container (`useScrollElement()`). Phone: page, mini player, tab bar; More and the now-playing sheet are bottom sheets.
- **Page** (`ui/Page.tsx`). `Page width="data|read|form"` > `PageHeader title actions` (+ `TabNav` as children for a surface with tabs) > sections 40px apart (48 from `md`; `SECTIONS` for a body under a shared header). The header is a two-column grid from `md`: title left, actions bottom-aligned right; on a phone the actions stack under the title. The range picker sits in the header actions of every ranged surface. One primary or accent button per surface: once a step is done, its repeat action (Connect again, import again) is secondary.
- **Patterns tab** (`surfaces/PatternsFrame.tsx`). Every Patterns tab renders through `PatternsFrame`: header, `TabNav`, range picker, first-use state. A tab only supplies its body.
- **Stat strip driving one chart.** At most three figures; the selected one draws the chart below it. Never a row of identical metric boxes.
- **Ranked list.** `RowList` of `TrackRow`/`ArtistRow`/`AlbumRow`: rank, art, title over subtitle, dither meter (when the list is 512px or wider), figure. Whole row is the link; songs get play and menu on hover, a context menu on right click. On desktop the actions overlay the figure (the figure hides while they show), so a row reserves no width for them; on a phone they sit in the row. Art: 32 in ranked lists and side columns (40 on a phone), 40 in rows with a second line of detail (skips, cleanup proposals, set songs, the queue), 48 in release and set lists, 64 for picks and the playlist list (the fixed cover). A set's art is its generated cover (`coverUrl`, the image saved as the playlist cover), in the set list and the set page header.
- **Log table.** Plays: virtualised rows grouped by day headings, columns that drop by width (`useColumns`), a phone row layout. Toolbar above, count line, then the table.
- **Entity page.** `EntityHeader` (artwork, title, credits, first and last play, Play plus secondary actions, range picker as `aside`) > stat strip driving the listening chart > main plus side column (ranked songs; albums, releases, versions) > skips in context, full width.
- **Main plus side column.** `SIDE_COLUMNS` (`lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]`): the main answer left, small related lists right.
- **Setting rows.** `SettingRows` separates rows with spacing only, no hairlines; a section heading groups them. A hairline is kept for selection or a table, never to divide settings.
- **Conversation** (`ui/Conversation`). Ask and the set page. With no messages the composer sits under the header with the starters below it. From the first message, or a starting run, the composer is pinned to the foot of the conversation column and the messages scroll above it: in the page panel it sticks to the bottom of the scroll area (so it clears the player bar, the mini player, the tab bar and the safe area, which sit outside that area; the viewport resizes for the on-screen keyboard); in a side column (`contained`, the set page from `lg`) the thread has its own scroll box. The view follows new messages and a streaming run while the reader is at the end; scrolled up, Jump to latest appears above the composer. Notices tied to the composer (a failed run, Claude not set up, the cap spent, Spotify paused) sit in the pinned block with it. During a run the send button is Stop, so `RunProgress` in a thread has no Cancel. The composer glides between the two places (`--dur-move`, `--ease-move`; instant with reduced motion).
- **Start a session.** `StartSessionButton` (secondary, small) sits beside a list of songs worth a session (Overview top songs, Forgotten, an era, keepers in Skips, a trip). It opens the queue panel, where the session runs.

### State order

Every data block resolves in this order, and builds each state with the shared components:

1. **Error** (`ErrorState` with retry) before anything else.
2. **Loading** (`Skeleton`, `RowSkeleton`, `ChartSkeleton`) in the shape of the content.
3. **First use** (`FirstUseState`: "No listening yet" and "Set up encore").
4. **Empty for this range or filter** (`EmptyState size="section"` with the control that widens it).
5. **Content**, including worst case: long names truncate with the full value in the link label; 0, 1 and huge counts format with `fmtCompact`/`fmtInt`; missing or broken art falls back to the kind's placeholder glyph.

Refetches keep the old data dimmed (`dimWhile(refetching)`, `opacity-60`) instead of flashing a skeleton. An unknown address renders `NotFound` ("This page does not exist", Open Overview); a missing recap, set, thread or entity says the same in its own page.

## 5. Components

All in `web/src/ui/` unless noted. Props listed are the ones that matter.

| Component | Import | Props |
| --- | --- | --- |
| `Button`, `buttonClass` | `ui/Button` | `variant` primary, accent, secondary, ghost, danger; `size` sm, md, lg; `icon`, `iconEnd`, `busy`, `busyLabel` |
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
| `showToast`, `Toaster` | `lib/toast`, `ui/Toast` | `showToast(message, "info" | "problem", { label, onClick })`. An action (Undo) keeps it open |
| `Skeleton`, `ChartSkeleton` | `ui/Skeleton` | Skeleton: `className` sets the shape. ChartSkeleton: `shape` bars or grid, in the chart's box |
| `EmptyState`, `FirstUseState` | `ui/States` | EmptyState: `icon`, `title`, `description`, `action`, `size` page, section, inline. FirstUseState: before any play is imported, `icon`, `description`, `title` (default "No listening yet"), action Set up encore |
| `ErrorState` | `ui/States` | `error`, `onRetry`, `title`, `size` |
| `Page`, `PageHeader`, `Section`, `useDocumentTitle`, `SECTIONS`, `SIDE_COLUMNS`, `dimWhile` | `ui/Page` | PageHeader: `title`, `description`, `actions`, children. Section: `title`, `description`, `actions`, `labelledBy` |
| `Stat`, `StatStrip`, `Delta` | `ui/Stat` | Items `{ id, label, value, unit?, delta?, compare? }`; StatStrip: `value`, `onChange`, `label`, children (the chart) |
| `AnimatedNumber` | `ui/AnimatedNumber` | `value` (formatted string) |
| `RowList`, `Row`, `TrackRow`, `ArtistRow`, `AlbumRow`, `RowSkeleton` | `ui/Rows` | `rank`, `value`, `share` (0 to 1, draws the meter), `subtitle`, `style` (position in a virtualised list). `Row` links only when given `to` (a song with no page, such as an unheard pick, stays plain). Set `--rank-w` on the list for ranks past 99 |
| `TableHead`, `useColumns`, `cellClass`, `Column` | `ui/Table` | Columns `{ id, label, width, align, from, srLabel }` drop below their `from` breakpoint |
| `EntityHeader`, `EntityHeaderSkeleton` | `ui/EntityHeader` | `title`, `art`, `kind`, `credits`, `detail`, `actions`, `aside`. The head of an artist, album, song or set page; the page sets the document title |
| `SearchField` | `ui/SearchField` | `value`, `onChange` (after a 250 ms pause), `label`, `placeholder` |
| `Artwork` | `ui/Artwork` | `src`, `kind` artist, album, song, playlist, `box` 24 to 64 or fill. Kind sets the shape (artists round) and the placeholder glyph. Loading is the bare fill; missing and broken images show the kind's glyph (microphone, record, note, playlist) in `text-tertiary` on `bg-fill`. Decorative: the name sits beside it |
| `SongMenu`, `SongContext` | `ui/SongMenu` | `song { uri, name, songKey?, artist? }` |
| `RangePicker` | `ui/RangePicker` | Reads and writes `from`/`to` in the URL |
| `RunProgress` | `ui/RunProgress` | `run` (from `useRun`), `title`, `onCancel` (omit in a `Conversation`: the composer's Stop cancels) |
| `Composer` | `ui/Composer` | `value`, `onChange`, `onSubmit`, `onStop`, `running`, `label`, `notice`, `footer` |
| `Conversation` | `ui/Conversation` | A thread with its composer (Ask, the set page). `messages` (null while empty), `composer` (the composer with its notices), `empty` (starters, under the composer while empty), `follow` (changes when a message is added), `startAtEnd`, `thread`, `contained` (own scroll box, fills the parent's height) |
| `useClaudeGate` | `ui/ClaudeNotice` | Gate: `needsSpotify`; returns `ready`, `blocked` (no API key, monthly cap spent: disable the run and show it as the composer `notice`), `warning` (Spotify paused, shown as a `Notice`), `spend` (composer `footer`) |
| `StartSessionButton` | `ui/StartSessionButton` | Starts a DJ session and opens the queue panel |
| `BlockedList` | `surfaces/BlockedList` | Songs and artists kept out of picks and sets, with Allow. Picks and Library |
| `Kbd`, `MOD_KEY` | `ui/Kbd` | Hidden on touch screens |
| `Icon` | `ui/Icon` | `icon`, `size`, `fill` |
| `EncoreMark`, `Lockup` | `ui/Brand` | Mark at 16, 32 or 48 only, in `text-accent-text` (Spotify green on dark, the deeper green on light, where Spotify green is 1.7:1 on the shell). The wordmark stays `text-primary`. Lockup 16 or 32. `public/favicon.svg` and `logo.svg` follow the colour scheme the same way; the PNG app icons draw the mark in Spotify green on near-black |
| `AppLink`, `useRangeHref` | `ui/AppLink` | A link that keeps the current range |
| Paths | `app/paths` | `artistPath(name)`, `songPath(key)`, `albumPath(artist, album)` |

`/dev/kit` (dev builds only) shows every primitive in its states. Fixtures: add `?fixture=loading|error|empty|new|worst|untagged|off`, `?player=playing`, `?dj=active` or `?run=running|starting|done|failed|budget|unconfigured|paused` (Claude runs answered by the fixture, never the server), `?history=before|none|slow|failed|env` (Settings, Ignore plays before; answered by the fixture, nothing deleted), `?living=connected|first|fresh|deferred|failed|empty|removed|scope|refreshing` (For you: Playlists; switches and refreshes answered by the fixture, nothing sent to Spotify), `?recap=none|facts|first|quiet` (Recaps: real periods bent to no recap yet, no Claude lines, history starting inside the period, almost no listening) to any dev URL (`web/src/dev/fixtures.ts`); the choice sticks for the tab until `off`.

## 6. Charts

One family: dithered halftone in Spotify green.

| Chart | Import | Use |
| --- | --- | --- |
| `DitherArea` | `charts/Dither` | One series over time (the stat strip chart) |
| `DitherBars`, `DitherStack`, `DitherLine`, `DitherRadar` | `charts/Dither` | Bars, stacked series, lines, radar. All draw through the vendored kit in `components/dither-kit/` |
| `DitherMeter` | `charts/DitherMeter` | A share bar in a row, always next to a printed figure |
| `ContextRates`, `contextRates()` | `charts/ContextRates` | Skip rate by context (weekday, hour, device, source) as `RateMeter` rows against the overall rate. Skips and the entity pages |
| `RateMeter` | `charts/RateMeter` | A rate on a fixed 0 to 100% track, with an optional tick for a reference rate (skip rate by context, share by device). Next to a printed figure |
| `DitherHeatmap`, `HeatLegend` | `charts/DitherHeatmap` | A grid of values (weekday by hour, artist by month). One tab stop, arrow keys move the selection. Column labels can be elements (artist avatars on phone) |
| `BudgetBar` | `charts/BudgetBar` | Spend against a cap: `spent`, `cap`, `label`. Turns red with a cap mark once spent reaches the cap |
| `InlinePair` | `charts/Inline` | This period over the one before as two short bars on one scale (dithered now, grey before). Inside a sentence, next to the figures |
| `InlineChange` | `charts/Inline` | The change from before to now as an arrow and a percentage, in neutral ink ("new", "no change" when there is nothing to divide) |
| `InlineColumns` | `charts/Inline` | A word-sized row of columns (each day, each hour) with one marked column. Sums long series into at most `bars` columns |
| `InlineShare` | `charts/Inline` | A share of the whole on a short track, with a tick where it stood before |
| `ArtChip` | `charts/Inline` | 20 px artwork beside a name, clamped to one line. The name is the label; the image is decoration |
| `ditherTile(level)`, `levelFor(share)` | `charts/ditherTile` | The halftone as a CSS background for anything that is not a canvas |
| `DataTable` | `charts/DataTable` | "View data": the accessible table behind every chart |

Inline charts are sized for a line of text and sit next to the figure they draw, never in place of it. Each takes a `label`: the sentence a screen reader hears instead of the picture ("42 h, against 30 h in October"). Recaps use them first; they are built to be reused (Ask). `/dev/kit` shows each one.

Rules: a chart answers one question and has a printed figure or sentence that states the answer ("Busiest: Fridays, 22:00 to 23:00"). Axis labels in `text-caption text-tertiary`. Every chart has a `DataTable`. Hover tooltips repeat data, they never hold it alone.

## 7. Copy

Apply the owner's ladder to every string: does it need to surface, does the label need to exist, does it pre-empt a problem the user never had? Delete at the first rung that fires.

- Sentence case. No exclamation marks. Numbers with units ("1,445 hours", "38 plays").
- Empty states say what is missing and the one step that fixes it: "No plays in this range" + the range picker.
- Errors say what failed and offer "Try again". No apology.
- Buttons are verbs: "Play", "Make a set", "Set up encore". A busy button swaps its label in place ("Waiting for passkey").
- Skips are context, never judgement: "Skipped", never "disliked".
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
