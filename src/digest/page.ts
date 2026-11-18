import { sql } from "drizzle-orm";
import { withArtistImages } from "../analytics/common";
import type { Db } from "../db/client";
import { withArtwork } from "../library/artwork";
import { normalizeTitle, songKey } from "../plays/song";
import { isRecapFacts, type LegacyFacts, type RecapFacts, type Share, type YearSide } from "./facts";
import { baselineLabel, humanDay, humanDatesIn, periodLabel, type RecapKind, type Span } from "./periods";
import { definingSongs } from "./songs";

export const SECTION_IDS = ["listening", "years", "months", "artists", "songs", "finds", "comebacks", "records", "taste", "rhythm"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** Claude's words for a recap: a headline and one take per section, none with a digit in it. */
export type RecapLines = { headline: string | null; takes: Partial<Record<SectionId, string>> };

type Run = { days: number; from: string; to: string };
type MilestoneSong = { songKey: string; uri: string; name: string; artist: string; albumArtUrl: string | null };
export type RecapRecord =
  | { record: "day"; day: string; hours: number }
  | { record: "session"; day: string; minutes: number; hours: number }
  | { record: "songDay"; day: string; listens: number; song: MilestoneSong }
  | { record: "week"; week: string; hours: number }
  | { record: "month"; month: string; hours: number };
export type RecapMilestone =
  | { kind: "song"; threshold: number; day: string; song: MilestoneSong }
  | { kind: "artist"; threshold: number; day: string; artist: string; imageUrl: string | null }
  | { kind: "total"; threshold: number; day: string };

type Mover = { artist: string; imageUrl: string | null; hours: number; before: number };
type SongItem = { songKey: string; uri: string | null; name: string; artist: string; albumArtUrl: string | null; listens: number };

export type RecapSection =
  | { id: "listening"; take: string | null; hours: number; before: number | null; listens: number; listensBefore: number | null; artists: number; songs: number; daily: number[] | null }
  | { id: "months"; take: string | null; months: { month: string; hours: number; artist: string | null; imageUrl: string | null; song: { name: string; artist: string } | null }[] }
  | { id: "artists"; take: string | null; top: { artist: string; imageUrl: string | null; hours: number; share: number; before: number | null }[]; up: Mover[]; down: Mover[] }
  | { id: "songs"; take: string | null; songs: (SongItem & { hours: number })[] }
  | { id: "taste"; take: string | null; genres: Share[]; moods: Share[] }
  | {
      id: "finds";
      take: string | null;
      /** Share of the period's hours on songs first played in it; null on recaps written before it was kept. */
      newShare: number | null;
      songs: { count: number; ofNew: number; top: SongItem[] };
      artists: { count: number; ofNew: number; top: { artist: string; imageUrl: string | null; listens: number }[] };
    }
  | { id: "comebacks"; take: string | null; items: { artist: string; imageUrl: string | null; lastBefore: string; returned: string; gapDays: number }[] }
  | { id: "records"; take: string | null; records: RecapRecord[]; milestones: RecapMilestone[] }
  | {
      id: "years";
      take: string | null;
      a: YearSide;
      b: YearSide;
      artists: { artist: string; imageUrl: string | null; a: { rank: number; hours: number } | null; b: { rank: number; hours: number } | null; change: number | null }[];
      genres: { value: string; a: number; b: number }[];
      moods: { value: string; a: number; b: number }[];
    }
  | { id: "rhythm"; take: string | null; day: { day: string; hours: number }; hour: { hour: number; hours: number } | null; byHour: number[] | null; streak: Run | null };

export type RecapPage = {
  kind: RecapKind;
  key: string;
  label: string;
  span: Span;
  inProgress: boolean;
  headline: string;
  /** Who wrote the headline: Claude, code from the numbers, or the first line of a recap written before recaps were pages. */
  headlineBy: "claude" | "facts" | "text";
  compare: { label: string; from: string; to: string; scaled: boolean } | null;
  /** Said once when there is no earlier period to compare with. */
  note: string | null;
  /** Almost no listening: only the totals are shown. */
  quiet: boolean;
  sections: RecapSection[];
  /** The full text of a recap written before recaps were pages, with dates made readable. */
  legacyText: string | null;
};

type Stored = { kind: RecapKind; periodKey: string; fromDay: string; toDay: string; facts: unknown; text: string; lines: RecapLines | null };

/** A take worth showing: an empty or missing one is left out. */
const take = (lines: RecapLines | null, id: SectionId) => lines?.takes[id]?.trim() || null;

const QUIET_LISTENS = 5;
const QUIET_HOURS = 0.5;
const TASTE_MOVE = 0.05;

export function fmtHoursPhrase(hours: number): string {
  if (hours * 60 < 1) return "under a minute";
  if (Math.round(hours * 60) < 60) return `${Math.round(hours * 60)} minutes`;
  return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} hours`;
}

function factsHeadline(top: string | null, hours: number): string {
  if (hours <= 0) return "No listening";
  return top ? `${fmtHoursPhrase(hours)} of music, most of it ${top}` : `${fmtHoursPhrase(hours)} of music`;
}

function images(db: Db, names: string[]): Map<string, string | null> {
  return new Map(withArtistImages(db, [...new Set(names)].map((artist) => ({ artist }))).map((a) => [a.artist, a.imageUrl]));
}

function noteFor(facts: RecapFacts, label: string): string | null {
  if (facts.baseline || !facts.historyStart) return null;
  const start = humanDay(facts.historyStart);
  return facts.historyStart > facts.period.from
    ? `Your history starts ${start}, partway through ${label}, so there is nothing earlier to compare with.`
    : `Your history starts ${start}, so there is nothing earlier to compare with.`;
}

function pageFromFacts(db: Db, d: Stored, f: RecapFacts, label: string): Pick<RecapPage, "sections" | "headline" | "headlineBy" | "compare" | "note" | "quiet"> {
  const lines = d.lines;
  const quiet = f.totals.listens < QUIET_LISTENS || f.totals.hours < QUIET_HOURS;
  const pics = images(
    db,
    [...f.artists, ...f.movers.up, ...f.movers.down, ...(f.comebacks ?? []), ...(f.years?.artists ?? [])]
      .map((a) => a.artist)
      .concat(f.months.flatMap((m) => (m.artist ? [m.artist] : [])), f.finds?.artists.top.map((a) => a.artist) ?? []),
  );
  const pic = (artist: string) => pics.get(artist) ?? null;
  const mover = (a: { artist: string; hours: number; before: number | null }) => ({ artist: a.artist, imageUrl: pic(a.artist), hours: a.hours, before: a.before ?? 0 });
  const sections: RecapSection[] = [
    {
      id: "listening",
      take: take(lines, "listening"),
      hours: f.totals.hours,
      before: f.totals.before?.hours ?? null,
      listens: f.totals.listens,
      listensBefore: f.totals.before?.listens ?? null,
      artists: f.totals.artists,
      songs: f.totals.songs,
      daily: f.daily,
    },
  ];
  if (!quiet) {
    const years = f.years ? { id: "years" as const, take: take(lines, "years"), ...f.years, artists: f.years.artists.map((a) => ({ ...a, imageUrl: pic(a.artist) })) } : null;
    if (years) sections.push(years);
    if (f.months.length >= 2)
      sections.push({ id: "months", take: take(lines, "months"), months: f.months.map((m) => ({ ...m, imageUrl: m.artist ? pic(m.artist) : null })) });
    if (f.artists.length)
      sections.push({
        id: "artists",
        take: take(lines, "artists"),
        top: f.artists.slice(0, 5).map((a) => ({ artist: a.artist, imageUrl: pic(a.artist), hours: a.hours, share: f.totals.hours ? a.hours / f.totals.hours : 0, before: a.before })),
        up: f.movers.up.map(mover),
        down: f.movers.down.map(mover),
      });
    const songs = definingSongs(db, d.kind, { from: f.period.from, to: f.period.to });
    if (songs.length) sections.push({ id: "songs", take: take(lines, "songs"), songs: songs.map(({ album: _album, ...s }) => s) });
    const moved = (s: Share[]) => s.filter((x) => x.before !== null && Math.abs(x.share - x.before) >= TASTE_MOVE).slice(0, 4);
    if (!years && (moved(f.genres).length || moved(f.moods).length)) sections.push({ id: "taste", take: take(lines, "taste"), genres: moved(f.genres), moods: moved(f.moods) });
    if (f.comebacks?.length)
      sections.push({ id: "comebacks", take: take(lines, "comebacks"), items: f.comebacks.map((c) => ({ artist: c.artist, imageUrl: pic(c.artist), lastBefore: c.lastBefore, returned: c.returned, gapDays: c.gapDays })) });
    if (f.records?.length || f.milestones?.length) sections.push({ id: "records", take: take(lines, "records"), records: f.records ?? [], milestones: f.milestones ?? [] });
    if (f.finds && (f.finds.songs.count || f.finds.artists.count)) {
      const art = new Map(withArtwork(db, f.finds.songs.top.map((s) => ({ songKey: s.key, artist: s.artist }))).map((s) => [s.songKey, s.albumArtUrl]));
      sections.push({
        id: "finds",
        take: take(lines, "finds"),
        newShare: f.discovery?.newShare ?? null,
        songs: { count: f.finds.songs.count, ofNew: f.finds.songs.ofNew, top: f.finds.songs.top.map((s) => ({ songKey: s.key, uri: s.uri, name: s.name, artist: s.artist, albumArtUrl: art.get(s.key) ?? null, listens: s.listens })) },
        artists: { count: f.finds.artists.count, ofNew: f.finds.artists.ofNew, top: f.finds.artists.top.map((a) => ({ artist: a.key, imageUrl: pic(a.key), listens: a.listens })) },
      });
    }
    if (f.busiest.day) sections.push({ id: "rhythm", take: take(lines, "rhythm"), day: f.busiest.day, hour: f.busiest.hour, byHour: f.busiest.byHour, streak: f.streak ?? null });
  }
  const headline = lines?.headline?.trim();
  return {
    sections,
    headline: headline || factsHeadline(f.artists[0]?.artist ?? null, f.totals.hours),
    headlineBy: headline ? "claude" : "facts",
    compare: f.baseline ? { label: baselineLabel(d.kind, d.periodKey, f.baseline, f.period.inProgress), from: f.baseline.from, to: f.baseline.to, scaled: false } : null,
    note: noteFor(f, label),
    quiet,
  };
}

/** A stored song's key. Keys use the credited artist, and a stored artist can be the canonical name an alias put on the track. */
function storedSongKey(db: Db, name: string, artist: string): string {
  const title = `${normalizeTitle(name)}|`;
  const keys = db.all<{ k: string }>(sql`select distinct song_key as k from tracks where artist = ${artist} or artist_credit = ${artist}`);
  return keys.find((r) => r.k.startsWith(title))?.k ?? songKey(name, artist);
}

/** A recap stored before recaps were pages: its numbers become the same sections, its first line the headline. */
function pageFromLegacy(db: Db, d: Stored, f: LegacyFacts): Pick<RecapPage, "sections" | "headline" | "headlineBy" | "compare" | "note" | "quiet"> {
  const t = f.totals;
  const artists = f.topArtists ?? [];
  const pics = images(db, [...artists, ...(f.risingArtists ?? []), ...(f.fadingArtists ?? []), ...(f.newArtists?.top ?? [])].map((a) => a.artist));
  const pic = (artist: string) => pics.get(artist) ?? null;
  const mover = (a: { artist: string; hours: number; baselineHours: number }) => ({ artist: a.artist, imageUrl: pic(a.artist), hours: a.hours, before: a.baselineHours });
  const sections: RecapSection[] = [];
  if (t) sections.push({ id: "listening", take: null, hours: t.hours, before: t.baselineHours, listens: t.listens, listensBefore: t.baselineListens, artists: t.uniqueArtists, songs: t.uniqueSongs, daily: null });
  if (artists.length)
    sections.push({
      id: "artists",
      take: null,
      top: artists.slice(0, 5).map((a) => ({ artist: a.artist, imageUrl: pic(a.artist), hours: a.hours, share: t?.hours ? a.hours / t.hours : 0, before: a.baselineHours })),
      up: (f.risingArtists ?? []).map(mover),
      down: (f.fadingArtists ?? []).map(mover),
    });
  const songs = definingSongs(db, d.kind, { from: d.fromDay, to: d.toDay });
  if (songs.length) sections.push({ id: "songs", take: null, songs: songs.map(({ album: _album, ...s }) => s) });
  const share = (s: { value: string; sharePct: number; baselineSharePct: number }) => ({ value: s.value, share: s.sharePct / 100, before: s.baselineSharePct / 100 });
  const moved = (s: { value: string; sharePct: number; baselineSharePct: number }[] = []) => s.map(share).filter((x) => Math.abs(x.share - x.before) >= TASTE_MOVE).slice(0, 4);
  if (moved(f.genres).length || moved(f.moods).length) sections.push({ id: "taste", take: null, genres: moved(f.genres), moods: moved(f.moods) });
  if (f.newSongs?.count || f.newArtists?.count) {
    const top = withArtwork(db, (f.newSongs?.top ?? []).map((s) => ({ songKey: storedSongKey(db, s.name, s.artist), name: s.name, artist: s.artist, listens: s.listens })));
    sections.push({
      id: "finds",
      take: null,
      newShare: null,
      songs: { count: f.newSongs?.count ?? 0, ofNew: f.newSongs?.count ?? 0, top: top.map((s) => ({ songKey: s.songKey, uri: null, name: s.name, artist: s.artist, albumArtUrl: s.albumArtUrl, listens: s.listens })) },
      artists: { count: f.newArtists?.count ?? 0, ofNew: f.newArtists?.count ?? 0, top: (f.newArtists?.top ?? []).map((a) => ({ artist: a.artist, imageUrl: pic(a.artist), listens: a.listens })) },
    });
  }
  if (f.busiestDay) sections.push({ id: "rhythm", take: null, day: f.busiestDay, hour: f.peakHour ?? null, byHour: null, streak: null });
  const first = d.text.split(/\n+/).map((l) => l.trim()).find(Boolean);
  return {
    sections,
    headline: first ? humanDatesIn(first) : factsHeadline(artists[0]?.artist ?? null, t?.hours ?? 0),
    headlineBy: first ? "text" : "facts",
    compare: f.baseline ? { label: d.kind === "weekly" ? "a typical week before it" : "a typical month before it", from: f.baseline.from, to: f.baseline.to, scaled: true } : null,
    note: null,
    quiet: false,
  };
}

/** The recap as a page: what the facts support, in order, with Claude's words where there are any. */
export function recapPage(db: Db, d: Stored): RecapPage {
  const label = periodLabel(d.kind, d.periodKey);
  const legacy = !isRecapFacts(d.facts);
  const built = legacy ? pageFromLegacy(db, d, d.facts as LegacyFacts) : pageFromFacts(db, d, d.facts as RecapFacts, label);
  const order = (s: RecapSection) => SECTION_IDS.indexOf(s.id);
  return {
    kind: d.kind,
    key: d.periodKey,
    label,
    span: { from: d.fromDay, to: d.toDay },
    inProgress: !legacy && (d.facts as RecapFacts).period.inProgress,
    ...built,
    sections: built.sections.sort((a, b) => order(a) - order(b)),
    legacyText: legacy ? humanDatesIn(d.text) : null,
  };
}
