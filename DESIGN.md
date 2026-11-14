# encore design

The contract for every screen in `web/`. Section 1 is the information architecture; the rest is how a surface is built. When this file and a screen disagree, the screen is wrong.

## 1. Information architecture

encore answers three jobs: **what have I been listening to**, **what should I play next**, and **keep my Spotify tidy**. Every surface belongs to one job and answers one question.

### Sitemap

```
Listening                      Play                        More (menu)          Foot
├── Overview          /        ├── For you    /for-you     ├── Recaps  /recaps  └── Settings /settings
├── Plays             /plays   │   ├── Picks     /picks     │   └── /recaps/:id        ├── general
├── Music             /music   │   └── Releases  /releases  ├── Library /library        ├── spotify
│   ├── Artists   /artists     ├── Sets       /sets         └── Setup   /setup          ├── claude
│   ├── Albums    /albums      │   └── /sets/:id                                        ├── integrations
│   ├── Songs     /songs       └── Ask        /ask                                      ├── jobs
│   ├── Forgotten /forgotten       └── /ask/:id                                         └── account
│   ├── /music/artist/:name
│   ├── /music/album/:artist/:album
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

The source of truth for paths, labels, icons and shortcuts is `web/src/app/nav.ts`. Phone tabs are the four Listening surfaces plus More.

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
| Sets `/sets` | Make me a playlist from a prompt | Make a set | `sets`, `sets/:id`, set run (stream), `dj/start`, `dj`, `dj/stop` | Built |
| Ask `/ask` | Answer a question about my listening | Ask | `ask/threads`, `ask/threads/:id`, ask run (stream) | Built |
| Recaps `/recaps` | What happened this week or month? | Open the latest recap | `digests`, `digests/:id` | Placeholder |
| Library `/library` | What in my saved songs and playlists should go? | Review proposals | `cleanup`, `cleanup/dismiss`, `cleanup/apply`, `cleanup/batches`, `cleanup/batches/:id/undo`, `blocks` | Placeholder |
| Setup `/setup` | Is encore connected and fed? | Do the next missing step | `onboarding`, `spotify/authorize`, `import`, `settings` | Placeholder |
| Settings `/settings/*` | How does encore run? | Save a change | `settings`, `settings/claude/verify`, `settings/discord/register`, `spotify/disconnect`, `spotify/poll`, `llm/spend`, `auth/logout`, passkey routes | Placeholder |

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
| Accent | `bg-accent`, `-hover`, `text-on-accent`, `text-accent-text`, `bg-accent-subtle` | Spotify green: the primary play action, selection, playing state, chart emphasis. Nothing else |
| Status | `text-danger`, `bg-danger-subtle`, `text-warning`, `bg-warning-subtle` | Errors, destructive actions, notices |
| Chart | `chart-key`, `chart-empty`, `chart-grid`, `chart-axis` | Around the dither canvases |

Positive change uses neutral text (see Delta), not a green: the accent is reserved.

### Type

Geist Variable (`font-sans`) for everything; Instrument Serif roman (`font-serif`) for page titles, figures and the wordmark only. Never italic.

| Style | Desktop | Phone | Use |
| --- | --- | --- | --- |
| `text-display` | 44/48 | 36/40 | Reserved (a recap headline) |
| `text-title` | 34/40 serif | 30/36 | Page title (`PageHeader`) |
| `text-figure` | 32/40 serif | 28/36 | Stat figures |
| `text-heading` | 15/20 medium | 17/24 | Section titles |
| `text-body` | 14/20 | 16/24 | Reading text, sentences |
| `text-body-sm` | 13/18 | 15/20 | Default UI text (body) |
| `text-caption` | 12/16 | 14/20 | Secondary lines, axes, metadata |
| `text-label` | 11/14 | 12/16 | Key caps, tab bar labels |

Weights: 400, 500 (labels, titles), 600 (rare). Numbers that line up use `tabular`.

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

- **Shell** (`app/Shell.tsx`). Desktop: `[sidebar | page panel | queue panel]` over the player bar; the page panel is the scroll container (`useScrollElement()`). Phone: page, mini player, tab bar; More and the now-playing sheet are bottom sheets.
- **Page** (`ui/Page.tsx`). `Page width="data|read|form"` > `PageHeader title actions` (+ `TabNav` as children for a surface with tabs) > sections 40px apart. The range picker sits in the header actions of every ranged surface.
- **Stat strip driving one chart.** At most three figures; the selected one draws the chart below it. Never a row of identical metric boxes.
- **Ranked list.** `RowList` of `TrackRow`/`ArtistRow`/`AlbumRow`: rank, art, title over subtitle, dither meter (when the list is 512px or wider), figure. Whole row is the link; songs get play and menu on hover, a context menu on right click.
- **Log table.** Plays: virtualised rows grouped by day headings, columns that drop by width (`useColumns`), a phone row layout. Toolbar above, count line, then the table.
- **Entity page.** `EntityHeader` (artwork, title, credits, first and last play, Play plus secondary actions, range picker as `aside`) > stat strip driving the listening chart > main plus side column (ranked songs; albums, releases, versions) > skips in context, full width.
- **Main plus side column.** `lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]`: the main answer left, small related lists right.

### State order

Every data block resolves in this order, and builds each state with the shared components:

1. **Error** (`ErrorState` with retry) before anything else.
2. **Loading** (`Skeleton`, `RowSkeleton`) in the shape of the content.
3. **First use** (`EmptyState size="page"` with the step that fixes it, usually "Set up encore").
4. **Empty for this range or filter** (`EmptyState size="section"` with the control that widens it).
5. **Content**, including worst case: long names truncate with the full value in the link label; 0, 1 and huge counts format with `fmtCompact`/`fmtInt`; missing art falls back to the dither avatar.

Refetches keep the old data dimmed (`opacity-60`) instead of flashing a skeleton.

## 5. Components

All in `web/src/ui/` unless noted. Props listed are the ones that matter.

| Component | Import | Props |
| --- | --- | --- |
| `Button`, `buttonClass` | `ui/Button` | `variant` primary, accent, secondary, ghost, danger; `size` sm, md, lg; `icon`, `iconEnd`, `busy`, `busyLabel` |
| `IconButton`, `iconButtonClass` | `ui/Button` | `icon`, `label` (required), `variant`, `size`, `fill` |
| `Input`, `Field` | `ui/Field` | Input: `icon`, `end`, `invalid`. Field: `label`, `hint`, `error`, render-prop child gets `id`, `aria-describedby`, `invalid` |
| `Select` | `ui/Select` | `value`, `onChange`, `options`, `label` |
| `Switch` | `ui/Switch` | `checked`, `onChange`, `label`, `disabled` |
| `Segmented` | `ui/Segmented` | Two to four views of the same data: `value`, `onChange`, `options`, `label` |
| `TabsRoot`, `TabList`, `TabPanel` | `ui/Segmented` | In-page tabs with an underline |
| `TabNav` | `ui/TabNav` | Route tabs under a page header: `items`, `label` |
| `MenuRoot`, `MenuTrigger`, `MenuPopup`, `MenuItem`, `MenuLinkItem`, `MenuSeparator`, `MenuLabel` | `ui/Menu` | Item: `icon`, `danger`, `hint` |
| `Dialog`, `DialogClose`, `Confirm` | `ui/Dialog` | Dialog: `open`, `onOpenChange`, `title`, `description`, `footer`, `width` 440, 560, 720 (bottom sheet on phone). Confirm: `action`, `danger`, `busy`, `onConfirm`. Prefer undo over confirm |
| `PopoverRoot`, `PopoverTrigger`, `PopoverPopup` | `ui/Popover` | `align` |
| `Tooltip` | `ui/Tooltip` | `label`, `side`. Never the only place information lives |
| `showToast`, `Toaster` | `lib/toast`, `ui/Toast` | `showToast(message, "info" | "problem", { label, onClick })`. An action (Undo) keeps it open |
| `Skeleton` | `ui/Skeleton` | `className` sets the shape |
| `EmptyState` | `ui/States` | `icon`, `title`, `description`, `action`, `size` page, section, inline |
| `ErrorState` | `ui/States` | `error`, `onRetry`, `title`, `size` |
| `Page`, `PageHeader`, `Section`, `useDocumentTitle` | `ui/Page` | PageHeader: `title`, `description`, `actions`, children. Section: `title`, `description`, `actions`, `labelledBy` |
| `Stat`, `StatStrip`, `Delta` | `ui/Stat` | Items `{ id, label, value, unit?, delta?, compare? }`; StatStrip: `value`, `onChange`, `label`, children (the chart) |
| `AnimatedNumber` | `ui/AnimatedNumber` | `value` (formatted string) |
| `RowList`, `Row`, `TrackRow`, `ArtistRow`, `AlbumRow`, `RowSkeleton` | `ui/Rows` | `rank`, `value`, `share` (0 to 1, draws the meter), `subtitle`, `style` (position in a virtualised list). Set `--rank-w` on the list for ranks past 99 |
| `TableHead`, `useColumns`, `cellClass`, `Column` | `ui/Table` | Columns `{ id, label, width, align, from, srLabel }` drop below their `from` breakpoint |
| `EntityHeader`, `EntityHeaderSkeleton` | `ui/EntityHeader` | `title`, `art`, `round`, `credits`, `detail`, `actions`, `aside`. The head of an artist, album or song page; the page sets the document title |
| `SearchField` | `ui/SearchField` | `value`, `onChange` (after a 250 ms pause), `label`, `placeholder` |
| `Artwork` | `ui/Artwork` | `src`, `name`, `box` 24 to 64 or fill, `round` |
| `SongMenu`, `SongContext` | `ui/SongMenu` | `song { uri, name, songKey?, artist? }` |
| `RangePicker` | `ui/RangePicker` | Reads and writes `from`/`to` in the URL |
| `RunProgress` | `ui/RunProgress` | `run` (from `useRun`), `title`, `onCancel` |
| `Composer` | `ui/Composer` | `value`, `onChange`, `onSubmit`, `onStop`, `running`, `label`, `notice`, `footer` |
| `useClaudeGate`, `RunNotice` | `ui/ClaudeNotice` | Gate: `needsSpotify`; returns `ready`, `blocked` (no API key, monthly cap spent: disable the run and show it as the composer `notice`), `warning` (Spotify paused), `spend` (composer `footer`). RunNotice: `tone` warning or danger, `onRetry` |
| `Kbd`, `MOD_KEY` | `ui/Kbd` | Hidden on touch screens |
| `Icon` | `ui/Icon` | `icon`, `size`, `fill` |
| `EncoreMark`, `Lockup` | `ui/Brand` | Mark at 16, 32 or 48 only. Lockup 16 or 32 |
| `AppLink`, `useRangeHref` | `ui/AppLink` | A link that keeps the current range |
| Paths | `app/paths` | `artistPath(name)`, `songPath(key)`, `albumPath(artist, album)` |
| `Placeholder` | `surfaces/Placeholder` | For a surface not yet built: header, tabs and an honest "Not built yet" state |

`/dev/kit` (dev builds only) shows every primitive in its states. Fixtures: add `?fixture=loading|error|empty|new|worst|untagged|off`, `?player=playing`, `?dj=active` or `?run=running|starting|done|failed|budget|unconfigured|paused` (Claude runs answered by the fixture, never the server) to any dev URL (`web/src/dev/fixtures.ts`); the choice sticks for the tab until `off`.

## 6. Charts

One family: dithered halftone in Spotify green.

| Chart | Import | Use |
| --- | --- | --- |
| `DitherArea` | `charts/Dither` | One series over time (the stat strip chart) |
| `DitherBars`, `DitherStack`, `DitherLine`, `DitherRadar` | `charts/Dither` | Bars, stacked series, lines, radar. All draw through the vendored kit in `components/dither-kit/` |
| `StackedArea`, `TagTrends`, `SegmentedBar`, `SkipProfileChart` | `charts/*` | Not used by any surface: Eras, Taste and Skips draw with `DitherHeatmap`, `DitherArea`, `DitherBars` and `RateMeter` |
| `DitherMeter` | `charts/DitherMeter` | A share bar in a row, always next to a printed figure |
| `RateMeter` | `charts/RateMeter` | A rate on a fixed 0 to 100% track, with an optional tick for a reference rate (skip rate by context, share by device). Next to a printed figure |
| `DitherHeatmap`, `HeatLegend` | `charts/DitherHeatmap` | A grid of values (weekday by hour, artist by month). One tab stop, arrow keys move the selection. Column labels can be elements (artist avatars on phone) |
| `ditherTile(level)`, `levelFor(share)` | `charts/ditherTile` | The halftone as a CSS background for anything that is not a canvas |
| `DataTable` | `charts/DataTable` | "View data": the accessible table behind every chart |

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
| Serif for titles and figures, roman | Italic accent words, all-caps tracked eyebrows, monospace labels, numbered section labels |
| Plain metadata in secondary text | Pills or badges for ordinary metadata |
| `EmptyState` and `ErrorState` from `ui/States` | Hand-made empty or error blocks |
| Tokens for every colour, radius, shadow, size | Literal values (`#…`, `text-[19px]`, `bg-white/10`) |
| 44px targets on phone; 24px with space on desktop | Small muted grey text to make density fit |
| Reduced-motion branch on every animation | Bounce, overshoot, motion that carries information alone |
| Play only on a user action | Autoplay, playback from a load or effect |
