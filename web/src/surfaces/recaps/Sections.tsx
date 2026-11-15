import { useState, type ReactNode } from "react";
import type { RecapPage, RecapSection, RecapShare } from "../../api/types";
import { artistPath, songPath } from "../../app/paths";
import { ArtChip, InlineChange, InlineColumns, InlineFact, InlinePair, InlineShare } from "../../charts/Inline";
import { fmtDayShort, fmtHour, fmtHoursValue, fmtInt, fmtMonthShort, hoursParts, WEEKDAYS } from "../../lib/format";
import { AppLink } from "../../ui/AppLink";
import { Button } from "../../ui/Button";
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

function Take({ text }: { text: string | null }) {
  return text ? <p className="text-body text-pretty text-primary">{text}</p> : null;
}

/** A line of figures and the small charts that draw them. */
function Line({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-body text-primary ${className ?? ""}`}>{children}</p>;
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
        {plural(s.listens, "play", "plays")}, {plural(s.artists, "artist", "artists")}, {plural(s.songs, "song", "songs")}
      </p>
      {s.daily && s.daily.length > 1 && busiest >= 0 && (
        <Line className="text-secondary">
          <InlineColumns
            values={s.daily}
            mark={busiest}
            bars={page.kind === "yearly" ? 53 : 31}
            label={`Listening each ${page.kind === "yearly" ? "week" : "day"} from ${fmtDayShort(page.span.from)} to ${fmtDayShort(page.span.to)}; the most on ${fmtDayShort(addDays(page.span.from, busiest))}`}
          />
          <span className="text-caption">{page.kind === "yearly" ? "Each week" : "Each day"}, {fmtDayShort(page.span.from)} to {fmtDayShort(page.span.to)}</span>
        </Line>
      )}
    </Section>
  );
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

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

function Artists({ s, page }: { s: Of<"artists">; page: RecapPage }) {
  return (
    <Section title="Artists">
      <Take text={s.take} />
      <ol className="flex flex-col">
        {s.top.map((a, i) => (
          <li key={a.artist} className="grid min-h-(--row-h-compact) grid-cols-[1.25rem_minmax(0,1fr)_auto_3.5rem] items-center gap-x-3 py-1">
            <span className="text-right text-caption text-tertiary tabular">{i + 1}</span>
            <ArtistLink name={a.artist} imageUrl={a.imageUrl} />
            <InlineShare share={a.share / (s.top[0]!.share || 1)} label={`${pct(a.share)} of your listening`} />
            <span className="text-right text-secondary tabular">{shortHours(a.hours)}</span>
          </li>
        ))}
      </ol>
      {(s.up.length > 0 || s.down.length > 0) && page.compare && (
        <div className="grid gap-4 md:grid-cols-2">
          {s.up.length > 0 && (
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-body-sm font-medium text-secondary">More than {page.compare.label}</h3>
              <ul className="flex flex-col gap-2">{s.up.map((m) => <Mover key={m.artist} m={m} />)}</ul>
            </div>
          )}
          {s.down.length > 0 && (
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-body-sm font-medium text-secondary">Less than {page.compare.label}</h3>
              <ul className="flex flex-col gap-2">{s.down.map((m) => <Mover key={m.artist} m={m} />)}</ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

const SONGS_SHOWN = 10;

export function Songs({ s, title, actions }: { s: Of<"songs">; title: string; actions?: ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <Section title={title}>
      <Take text={s.take} />
      {actions}
      <RowList label={title}>
        {(all ? s.songs : s.songs.slice(0, SONGS_SHOWN)).map((t, i) => (
          <TrackRow
            key={t.songKey}
            rank={i + 1}
            song={{ songKey: t.songKey, uri: t.uri ?? "", name: t.name, artist: t.artist, album: null, albumArtUrl: t.albumArtUrl, hours: t.hours, plays: t.listens, listens: t.listens, skips: 0, skipRate: null, earlySkips: 0, firstPlayed: null, lastPlayed: null }}
            value={plural(t.listens, "play", "plays")}
          />
        ))}
      </RowList>
      {s.songs.length > SONGS_SHOWN && (
        <Button variant="ghost" size="sm" className="-ml-2.5 self-start" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${fmtInt(s.songs.length)}`}
        </Button>
      )}
    </Section>
  );
}

function ShareRows({ title, rows, compare }: { title: string; rows: RecapShare[]; compare: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-body-sm font-medium text-secondary">{title}</h3>
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
      <div className="grid gap-6 md:grid-cols-2">
        <ShareRows title="Genres" rows={s.genres} compare={compare} />
        <ShareRows title="Moods" rows={s.moods} compare={compare} />
      </div>
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
      {s.songs.count > 0 && (
        <div className="flex flex-col gap-2">
          <Line>
            {!legacy && <InlineShare share={s.songs.count / Math.max(1, s.songs.ofNew)} label={lead(s.songs.count, s.songs.ofNew, "song", "songs")} />}
            <span className="min-w-0 flex-1">{lead(s.songs.count, s.songs.ofNew, "song", "songs")}</span>
          </Line>
          <ul className="flex flex-col gap-1.5">
            {s.songs.top.map((t) => (
              <li key={t.songKey} className="flex min-w-0 items-center gap-2">
                <AppLink to={songPath(t.songKey)} className="inline-flex min-h-7 min-w-0 items-center rounded-xs hover:underline hover:underline-offset-2" title={`${t.name}, ${t.artist}`}>
                  <ArtChip src={t.albumArtUrl} kind="song">
                    {t.name} <span className="text-secondary">{t.artist}</span>
                  </ArtChip>
                </AppLink>
                <span className="shrink-0 text-secondary tabular">{plural(t.listens, "play", "plays")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.artists.count > 0 && (
        <div className="flex flex-col gap-2">
          <Line>
            {!legacy && <InlineShare share={s.artists.count / Math.max(1, s.artists.ofNew)} label={lead(s.artists.count, s.artists.ofNew, "artist", "artists")} />}
            <span className="min-w-0 flex-1">{lead(s.artists.count, s.artists.ofNew, "artist", "artists")}</span>
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

const DAY_BARS: Record<RecapPage["kind"], number> = { weekly: 7, monthly: 31, yearly: 53 };

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
    </Section>
  );
}

const SONGS_TITLE: Record<RecapPage["kind"], (label: string) => string> = {
  weekly: () => "Songs of the week",
  monthly: (label) => `Songs of ${label.split(" ")[0]}`,
  yearly: (label) => `Songs of ${label}`,
};

/** The recap's sections in the order the page gives them. `songsActions` sits on the songs section (play, save). */
export function RecapSections({ page, songsActions }: { page: RecapPage; songsActions?: ReactNode }) {
  return (
    <>
      {page.sections.map((s) => {
        switch (s.id) {
          case "listening":
            return <Listening key={s.id} s={s} page={page} />;
          case "months":
            return <Months key={s.id} s={s} />;
          case "artists":
            return <Artists key={s.id} s={s} page={page} />;
          case "songs":
            return <Songs key={s.id} s={s} title={SONGS_TITLE[page.kind](page.label)} actions={songsActions} />;
          case "taste":
            return <Taste key={s.id} s={s} page={page} />;
          case "finds":
            return <Finds key={s.id} s={s} page={page} />;
          case "rhythm":
            return <Rhythm key={s.id} s={s} page={page} />;
        }
      })}
    </>
  );
}
