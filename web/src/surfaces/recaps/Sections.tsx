import { useState, type ReactNode } from "react";
import type { RecapMilestone, RecapPage, RecapRecord, RecapSection, RecapShare } from "../../api/types";
import { artistPath, songPath } from "../../app/paths";
import { ArtChip, InlineChange, InlineColumns, InlineFact, InlinePair, InlineShare } from "../../charts/Inline";
import { fmtDayShort, fmtHour, fmtHoursValue, fmtInt, fmtMonthLong, fmtMonthShort, hoursParts, WEEKDAYS } from "../../lib/format";
import { AppLink } from "../../ui/AppLink";
import { Button } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { Section } from "../../ui/Page";
import { RowList, TrackRow } from "../../ui/Rows";

type Of<K extends RecapSection["id"]> = Extract<RecapSection, { id: K }>;

const hours = (h: number) => {
  const p = hoursParts(h);
  return `${p.value} ${p.unit}`;
};
const shortHours = (h: number) => (h <= 0 ? "none" : h * 60 < 60 ? `${Math.round(h * 60)} min` : `${fmtHoursValue(h)} h`);
const pct = (share: number) => `${Math.round(share * 100)}%`;
const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;
const weekday = (day: string) => WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]!;
const dayLong = (day: string) => `${weekday(day)} ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))}`;
const tagName = (tag: string) => tag.charAt(0).toUpperCase() + tag.slice(1).replace(/-/g, " ");
const gap = (days: number) => (days >= 60 ? `${Math.round(days / 30.4)} months` : plural(days, "day", "days"));

/** A short list that shows its first few and opens the rest on a tap. */
function useMore<T>(items: T[], first: number) {
  const [all, setAll] = useState(false);
  const toggle =
    items.length > first ? (
      <Button variant="ghost" size="sm" className="-ml-2.5 self-start" onClick={() => setAll((v) => !v)}>
        {all ? "Show fewer" : `Show all ${fmtInt(items.length)}`}
      </Button>
    ) : null;
  return { shown: all ? items : items.slice(0, first), toggle };
}

function Take({ text }: { text: string | null }) {
  return text ? <p className="max-w-(--measure) text-body text-pretty text-primary">{text}</p> : null;
}

/** A line of figures and the small charts that draw them. */
function Line({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-primary", className)}>{children}</p>;
}

function ArtistLink({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  return (
    <AppLink to={artistPath(name)} className="inline-flex min-h-7 min-w-0 items-center rounded-xs hover:underline hover:underline-offset-2" title={name}>
      <ArtChip src={imageUrl} kind="artist">
        {name}
      </ArtChip>
    </AppLink>
  );
}

function SongLink({ song }: { song: { songKey: string; name: string; artist: string; albumArtUrl: string | null } }) {
  return (
    <AppLink to={songPath(song.songKey)} className="inline-flex min-h-7 min-w-0 items-center rounded-xs hover:underline hover:underline-offset-2" title={`${song.name}, ${song.artist}`}>
      <ArtChip src={song.albumArtUrl} kind="song">
        {song.name} <span className="text-secondary">{song.artist}</span>
      </ArtChip>
    </AppLink>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-body-sm font-medium text-secondary">{children}</h3>;
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function Listening({ s, page }: { s: Of<"listening">; page: RecapPage }) {
  const figure = hoursParts(s.hours);
  const busiest = s.daily ? s.daily.indexOf(Math.max(...s.daily)) : -1;
  return (
    <Section title="Listening">
      <Take text={s.take} />
      <p className="flex items-baseline gap-1.5">
        <span className="font-display text-figure text-primary tabular">{figure.value}</span>
        <span className="text-secondary">{figure.unit}</span>
      </p>
      {page.compare && s.before !== null && (
        <Line>
          <InlinePair now={s.hours} before={s.before} label={`${hours(s.hours)}, against ${hours(s.before)} in ${page.compare.label}`} />
          <InlineChange now={s.hours} before={s.before} />
          <span className="min-w-0 text-secondary">
            against {shortHours(s.before)} in {page.compare.label}
          </span>
        </Line>
      )}
      <p className="text-secondary">
        {plural(s.listens, "listen", "listens")}, {plural(s.artists, "artist", "artists")}, {plural(s.songs, "song", "songs")}
      </p>
      {s.daily && s.daily.length > 1 && busiest >= 0 && (
        <Line className="text-secondary">
          <InlineColumns
            values={s.daily}
            mark={busiest}
            bars={page.kind === "yearly" ? 53 : 31}
            label={`Listening each ${page.kind === "yearly" ? "week" : "day"} from ${fmtDayShort(page.span.from)} to ${fmtDayShort(page.span.to)}; the most on ${fmtDayShort(addDays(page.span.from, busiest))}`}
          />
          <span className="text-caption">
            {page.kind === "yearly" ? "Each week" : "Each day"}, {fmtDayShort(page.span.from)} to {fmtDayShort(page.span.to)}
          </span>
        </Line>
      )}
    </Section>
  );
}

const rankChange = (change: number | null, before: { rank: number } | null) => {
  if (change === null) return before ? "" : "new";
  if (change === 0) return "same place";
  return `${change > 0 ? "↑" : "↓"} ${fmtInt(Math.abs(change))}`;
};

function YearShares({ title, rows, before }: { title: string; rows: Of<"years">["genres"]; before: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SubHeading>{title}</SubHeading>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.value} className="grid grid-cols-[minmax(0,1fr)_4rem_auto] items-center gap-x-3">
            <span className="line-clamp-1 [overflow-wrap:anywhere]">{tagName(r.value)}</span>
            <InlineShare share={r.b} before={r.a} label={`${tagName(r.value)}: ${pct(r.b)} of tagged listening, from ${pct(r.a)} in ${before}`} />
            <span className="text-secondary tabular">
              {pct(r.b)} <span className="text-tertiary">from {pct(r.a)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A year against the year before. Hours stay with Listening; while the year runs, so do the totals, which Listening compares over the same days. */
function Years({ s, page }: { s: Of<"years">; page: RecapPage }) {
  const figures: [string, number, number, (n: number) => string][] = [
    ["Plays", s.a.plays, s.b.plays, fmtInt],
    ["New artists", s.a.newArtists, s.b.newArtists, fmtInt],
    ["New songs", s.a.newSongs, s.b.newSongs, fmtInt],
  ];
  return (
    <Section title={`Against ${s.a.year}`}>
      <Take text={s.take} />
      {!page.inProgress && (
        <ul className="flex flex-col">
          {figures.map(([label, a, b, fmt]) => (
            <li key={label} className="grid min-h-(--row-h-compact) grid-cols-[minmax(0,1fr)_3rem_4.5rem_4rem] items-center gap-x-3 py-1 sm:grid-cols-[10rem_3rem_4.5rem_minmax(0,1fr)]">
              <span className="text-secondary">{label}</span>
              <InlinePair now={b} before={a} label={`${label}: ${fmt(b)} in ${s.b.year}, against ${fmt(a)} in ${s.a.year}`} />
              <span className="text-right text-primary tabular">{fmt(b)}</span>
              <span className="text-secondary tabular">
                <InlineChange now={b} before={a} /> <span className="hidden sm:inline">from {fmt(a)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <SubHeading>Top artists, with their place in {s.a.year}</SubHeading>
        <ol className="flex flex-col">
          {s.artists.map((a) => (
            <li key={a.artist} className="grid min-h-(--row-h-compact) grid-cols-[1.25rem_minmax(0,1fr)_auto_3.5rem] items-center gap-x-3 py-1">
              <span className="text-right text-caption text-tertiary tabular">{a.b?.rank}</span>
              <ArtistLink name={a.artist} imageUrl={a.imageUrl} />
              <span className="text-secondary tabular whitespace-nowrap">{rankChange(a.change, a.a)}</span>
              <span className="text-right text-secondary tabular">{a.b ? shortHours(a.b.hours) : ""}</span>
            </li>
          ))}
        </ol>
      </div>
      {(s.genres.length > 0 || s.moods.length > 0) && (
        <div className="grid gap-6 md:grid-cols-2">
          <YearShares title="Genres" rows={s.genres} before={s.a.year} />
          <YearShares title="Moods" rows={s.moods} before={s.a.year} />
        </div>
      )}
    </Section>
  );
}

function Months({ s }: { s: Of<"months"> }) {
  const max = Math.max(...s.months.map((m) => m.hours)) || 1;
  return (
    <Section title="Month by month">
      <Take text={s.take} />
      <ol className="flex flex-col">
        {s.months.map((m) => (
          <li key={m.month} className="grid min-h-(--row-h-compact) grid-cols-[2.5rem_4rem_3.5rem_minmax(0,1fr)] items-center gap-x-3 py-1 md:grid-cols-[2.5rem_4rem_3.5rem_minmax(0,1fr)_minmax(0,1fr)]">
            <span className="text-secondary">{fmtMonthShort(m.month)}</span>
            <InlineShare share={m.hours / max} label={`${hours(m.hours)} in ${fmtMonthShort(m.month)}`} />
            <span className="text-right text-secondary tabular">{shortHours(m.hours)}</span>
            {m.artist ? <ArtistLink name={m.artist} imageUrl={m.imageUrl} /> : <span />}
            <span className="hidden min-w-0 truncate text-secondary md:block">{m.song ? `${m.song.name}` : ""}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Mover({ m }: { m: { artist: string; imageUrl: string | null; hours: number; before: number } }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <ArtistLink name={m.artist} imageUrl={m.imageUrl} />
      <InlinePair now={m.hours} before={m.before} label={`${m.artist}: ${hours(m.hours)}, from ${hours(m.before)}`} />
      <span className="shrink-0 text-secondary tabular">
        {shortHours(m.before)} to {shortHours(m.hours)}
      </span>
    </li>
  );
}

/** In a year with a year before, Against already ranks the top artists, so only who rose and fell is added. */
function Artists({ s, page }: { s: Of<"artists">; page: RecapPage }) {
  const ranked = page.sections.some((x) => x.id === "years");
  if (ranked && s.up.length === 0 && s.down.length === 0) return null;
  return (
    <Section title={ranked ? "Rising and falling" : "Artists"}>
      <Take text={s.take} />
      {!ranked && <ol className="flex flex-col">
        {s.top.map((a, i) => (
          <li key={a.artist} className="grid min-h-(--row-h-compact) grid-cols-[1.25rem_minmax(0,1fr)_auto_3.5rem] items-center gap-x-3 py-1">
            <span className="text-right text-caption text-tertiary tabular">{i + 1}</span>
            <ArtistLink name={a.artist} imageUrl={a.imageUrl} />
            <InlineShare share={a.share / (s.top[0]!.share || 1)} label={`${pct(a.share)} of your listening`} />
            <span className="text-right text-secondary tabular">{shortHours(a.hours)}</span>
          </li>
        ))}
      </ol>}
      {(s.up.length > 0 || s.down.length > 0) && page.compare && (
        <div className="grid gap-4 md:grid-cols-2">
          {s.up.length > 0 && (
            <div className="flex min-w-0 flex-col gap-2">
              <SubHeading>More than {page.compare.label}</SubHeading>
              <ul className="flex flex-col gap-2">
                {s.up.map((m) => (
                  <Mover key={m.artist} m={m} />
                ))}
              </ul>
            </div>
          )}
          {s.down.length > 0 && (
            <div className="flex min-w-0 flex-col gap-2">
              <SubHeading>Less than {page.compare.label}</SubHeading>
              <ul className="flex flex-col gap-2">
                {s.down.map((m) => (
                  <Mover key={m.artist} m={m} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

const SONGS_SHOWN = 10;

export function Songs({ s, title, actions }: { s: Of<"songs">; title: string; actions?: ReactNode }) {
  const { shown, toggle } = useMore(s.songs, SONGS_SHOWN);
  return (
    <Section title={title} actions={actions}>
      <Take text={s.take} />
      <RowList label={title}>
        {shown.map((t, i) => (
          <TrackRow
            key={t.songKey}
            rank={i + 1}
            song={{ songKey: t.songKey, uri: t.uri ?? "", name: t.name, artist: t.artist, album: null, albumArtUrl: t.albumArtUrl, hours: t.hours, plays: t.listens, listens: t.listens, skips: 0, skipRate: null, earlySkips: 0, firstPlayed: null, lastPlayed: null }}
            value={plural(t.listens, "play", "plays")}
          />
        ))}
      </RowList>
      {toggle}
    </Section>
  );
}

function ShareRows({ title, rows, compare }: { title: string; rows: RecapShare[]; compare: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SubHeading>{title}</SubHeading>
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <li key={r.value} className="grid grid-cols-[minmax(0,1fr)_4rem_auto] items-center gap-x-3">
            <span className="line-clamp-1 [overflow-wrap:anywhere]">{tagName(r.value)}</span>
            <InlineShare share={r.share} before={r.before} label={`${tagName(r.value)}: ${pct(r.share)} of tagged listening, from ${pct(r.before ?? 0)} in ${compare}`} />
            <span className="text-secondary tabular">
              {pct(r.share)} <span className="text-tertiary">from {pct(r.before ?? 0)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Taste({ s, page }: { s: Of<"taste">; page: RecapPage }) {
  const compare = page.compare?.label ?? "before";
  return (
    <Section title="Genres and moods">
      <Take text={s.take} />
      <ShareRows title="Genres" rows={s.genres} compare={compare} />
      <ShareRows title="Moods" rows={s.moods} compare={compare} />
    </Section>
  );
}

function Finds({ s, page }: { s: Of<"finds">; page: RecapPage }) {
  const legacy = page.legacyText !== null;
  const lead = (count: number, ofNew: number, one: string, many: string) =>
    legacy ? `${plural(count, `new ${one}`, `new ${many}`)}` : `${fmtInt(count)} of ${plural(ofNew, `new ${one}`, `new ${many}`)} came back on another day`;
  return (
    <Section title="New to you">
      <Take text={s.take} />
      {s.newShare !== null && s.newShare !== undefined && (
        <InlineFact label="On new songs" figure={pct(s.newShare)} mark={<InlineShare share={s.newShare} label={`${pct(s.newShare)} of the time on songs new to you`} />}>
          of the time
        </InlineFact>
      )}
      {s.songs.count > 0 && (
        <div className="flex flex-col gap-2">
          <Line>
            <span className="min-w-0 flex-1 text-secondary">{lead(s.songs.count, s.songs.ofNew, "song", "songs")}</span>
          </Line>
          <ul className="flex flex-col gap-1.5">
            {s.songs.top.map((t) => (
              <li key={t.songKey} className="flex min-w-0 items-center justify-between gap-2">
                <SongLink song={t} />
                <span className="shrink-0 text-secondary tabular">{plural(t.listens, "play", "plays")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.artists.count > 0 && (
        <div className="flex flex-col gap-2">
          <Line>
            <span className="min-w-0 flex-1 text-secondary">{lead(s.artists.count, s.artists.ofNew, "artist", "artists")}</span>
          </Line>
          <ul className="flex flex-col gap-1.5">
            {s.artists.top.map((a) => (
              <li key={a.artist} className="flex min-w-0">
                <ArtistLink name={a.artist} imageUrl={a.imageUrl} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

const COMEBACKS_SHOWN = 5;

function Comebacks({ s }: { s: Of<"comebacks"> }) {
  const { shown, toggle } = useMore(s.items, COMEBACKS_SHOWN);
  return (
    <Section title="Back again">
      <Take text={s.take} />
      <ul className="flex flex-col gap-1.5">
        {shown.map((c) => (
          <li key={`${c.artist}:${c.returned}`} className="flex min-w-0 items-center justify-between gap-3">
            <ArtistLink name={c.artist} imageUrl={c.imageUrl} />
            <span className="shrink-0 text-secondary" title={`Last played ${fmtDayShort(c.lastBefore)}, back ${fmtDayShort(c.returned)}`}>
              after {gap(c.gapDays)}
            </span>
          </li>
        ))}
      </ul>
      {toggle}
    </Section>
  );
}

function RecordItem({ r }: { r: RecapRecord }) {
  switch (r.record) {
    case "day":
      return <InlineFact label="Biggest day yet" figure={shortHours(r.hours)}>{dayLong(r.day)}</InlineFact>;
    case "session":
      return <InlineFact label="Longest session yet" figure={hours(r.minutes / 60)}>{dayLong(r.day)}</InlineFact>;
    case "week":
      return <InlineFact label="Biggest week yet" figure={shortHours(r.hours)}>from {fmtDayShort(r.week)}</InlineFact>;
    case "month":
      return <InlineFact label="Biggest month yet" figure={shortHours(r.hours)}>{fmtMonthLong(r.month)}</InlineFact>;
    case "songDay":
      return (
        <div className="flex flex-col gap-1">
          <InlineFact label="One song, most in a day" figure={plural(r.listens, "play", "plays")}>{dayLong(r.day)}</InlineFact>
          <SongLink song={r.song} />
        </div>
      );
  }
}

function MilestoneItem({ m }: { m: RecapMilestone }) {
  const when = <span className="shrink-0 text-secondary">{fmtDayShort(m.day)}</span>;
  if (m.kind === "total")
    return (
      <li className="flex items-center justify-between gap-3">
        <span>All your music passed {plural(m.threshold, "hour", "hours")}</span>
        {when}
      </li>
    );
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      {m.kind === "song" ? <SongLink song={m.song} /> : <ArtistLink name={m.artist} imageUrl={m.imageUrl} />}
      <span className="flex justify-between gap-3 text-secondary">
        <span>passed {m.kind === "song" ? plural(m.threshold, "play", "plays") : plural(m.threshold, "hour", "hours")}</span>
        {when}
      </span>
    </li>
  );
}

const MILESTONES_SHOWN = 5;

function Records({ s }: { s: Of<"records"> }) {
  const { shown, toggle } = useMore(s.milestones, MILESTONES_SHOWN);
  return (
    <Section title="Records">
      <Take text={s.take} />
      {s.records.map((r) => (
        <RecordItem key={r.record} r={r} />
      ))}
      {s.milestones.length > 0 && (
        <div className="flex flex-col gap-2">
          <SubHeading>Milestones</SubHeading>
          <ul className="flex flex-col gap-2.5">
            {shown.map((m, i) => (
              <MilestoneItem key={i} m={m} />
            ))}
          </ul>
          {toggle}
        </div>
      )}
    </Section>
  );
}

const DAY_BARS: Record<RecapPage["kind"], number> = { weekly: 7, monthly: 31, yearly: 53 };
/** A run of days worth a line: shorter ones happen in almost every period. */
const STREAK_SHOWN_FROM = 3;

function Rhythm({ s, page }: { s: Of<"rhythm">; page: RecapPage }) {
  const listening = page.sections.find((x): x is Of<"listening"> => x.id === "listening");
  const dayIndex = listening?.daily ? Math.round((Date.parse(`${s.day.day}T00:00:00Z`) - Date.parse(`${page.span.from}T00:00:00Z`)) / 86_400_000) : -1;
  const each = page.kind === "yearly" ? "week" : "day";
  return (
    <Section title="When">
      <Take text={s.take} />
      <InlineFact
        label="Busiest day"
        figure={shortHours(s.day.hours)}
        mark={
          listening?.daily &&
          dayIndex >= 0 && (
            <InlineColumns values={listening.daily} mark={dayIndex} bars={DAY_BARS[page.kind]} label={`Listening each ${each}; the most ${page.kind === "yearly" ? "in the week of" : "on"} ${dayLong(s.day.day)}`} />
          )
        }
      >
        {dayLong(s.day.day)}
      </InlineFact>
      {s.hour && (
        <InlineFact
          label="Busiest hour"
          figure={shortHours(s.hour.hours)}
          mark={s.byHour && <InlineColumns values={s.byHour} mark={s.hour.hour} bars={24} label={`Listening by hour of the day; the most from ${fmtHour(s.hour.hour)}`} />}
        >
          {fmtHour(s.hour.hour)} to {fmtHour((s.hour.hour + 1) % 24)}
        </InlineFact>
      )}
      {s.streak && s.streak.days >= STREAK_SHOWN_FROM && (
        <InlineFact label="Longest run" figure={plural(s.streak.days, "day", "days")}>
          in a row, {fmtDayShort(s.streak.from)} to {fmtDayShort(s.streak.to)}
        </InlineFact>
      )}
    </Section>
  );
}

const SONGS_TITLE: Record<RecapPage["kind"], (label: string) => string> = {
  weekly: () => "Songs of the week",
  monthly: (label) => `Songs of ${label.split(" ")[0]}`,
  yearly: (label) => `Songs of ${label}`,
};

/** Sections that answer how much and what: they read down the main column. The rest are side lists. */
const MAIN: RecapSection["id"][] = ["listening", "years", "months", "artists", "songs"];

function SectionView({ s, page, songsActions }: { s: RecapSection; page: RecapPage; songsActions?: ReactNode }) {
  switch (s.id) {
    case "listening":
      return <Listening s={s} page={page} />;
    case "years":
      return <Years s={s} page={page} />;
    case "months":
      return <Months s={s} />;
    case "artists":
      return <Artists s={s} page={page} />;
    case "songs":
      return <Songs s={s} title={SONGS_TITLE[page.kind](page.label)} actions={songsActions} />;
    case "taste":
      return <Taste s={s} page={page} />;
    case "finds":
      return <Finds s={s} page={page} />;
    case "comebacks":
      return <Comebacks s={s} />;
    case "records":
      return <Records s={s} />;
    case "rhythm":
      return <Rhythm s={s} page={page} />;
  }
}

/**
 * The recap's sections: how much and what down the main column, held to the reading measure; discoveries, comebacks,
 * records, when and genres in the side column. On a phone the side follows the main.
 */
export function RecapSections({ page, songsActions }: { page: RecapPage; songsActions?: ReactNode }) {
  const main = page.sections.filter((s) => MAIN.includes(s.id));
  const side = page.sections.filter((s) => !MAIN.includes(s.id));
  return (
    <div className="grid gap-10 md:gap-12 @min-[700px]/page:grid-cols-[minmax(0,1fr)_minmax(0,320px)] @min-[700px]/page:gap-16">
      <div className="flex min-w-0 max-w-(--measure) flex-col gap-10 md:gap-12">
        {main.map((s) => (
          <SectionView key={s.id} s={s} page={page} songsActions={songsActions} />
        ))}
      </div>
      {side.length > 0 && (
        <div className="flex min-w-0 flex-col gap-10 md:gap-12">
          {side.map((s) => (
            <SectionView key={s.id} s={s} page={page} />
          ))}
        </div>
      )}
    </div>
  );
}
