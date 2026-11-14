import { sql } from "drizzle-orm";
import { z } from "zod";
import { FINISH_KNOWN, FINISHED, LISTEN, MUSIC } from "../analytics/common";
import type { Db } from "../db/client";
import { localTime } from "../plays/localTime";
import { appOwnedPlaylistIds } from "./owned";

const DAY_MS = 86_400_000;

export const PLAY_CLASSES = ["active", "fading", "dormant", "never"] as const;
export type PlayClass = (typeof PLAY_CLASSES)[number];

/**
 * Classes rest on the last listen (`LISTEN` in analytics/common) and nothing else: a skip neither condemns a song
 * nor keeps it active. Bounds measured on the owner's library: the 180-day bound sits in the trough of the
 * last-listen distribution (10 of 1,951 saved songs last listened 150 to 179 days ago).
 */
export const CLASS_RULES = { fadingAfterDays: 90, dormantAfterDays: 180, unsavedMinListens: 10 };

export function playClass(lastListen: number | null, now: number): PlayClass {
  if (lastListen === null) return "never";
  const days = (now - lastListen) / DAY_MS;
  if (days < CLASS_RULES.fadingAfterDays) return "active";
  if (days < CLASS_RULES.dormantAfterDays) return "fading";
  return "dormant";
}

export type SongStats = { plays: number; listens: number; lastListen: number | null; lastPlay: number; finished: number; finishKnown: number };

type SongMeta = { uri: string; songKey: string; name: string; artist: string; album: string | null; albumArtUrl: string | null };

export type LibraryEntry = SongMeta & {
  where: { kind: "liked" } | { kind: "playlist"; id: string; name: string };
  /** Date saved (liked songs) or added to the playlist; null when Spotify did not say. */
  addedAt: number | null;
  /** Positions in the playlist, in order; empty for liked songs. */
  positions: number[];
  stats: SongStats | null;
  class: PlayClass;
};

export type PlaylistInfo = { id: string; name: string; itemCount: number };

export type LibrarySnapshot = {
  now: number;
  timezone: string;
  /** The history start setting, else the first local day with a stored play. */
  historyStart: string | null;
  liked: LibraryEntry[];
  playlists: PlaylistInfo[];
  /** One entry per song per playlist; duplicates share an entry with several positions. */
  playlistEntries: LibraryEntry[];
  stats: Map<string, SongStats & SongMeta>;
  savedKeys: Set<string>;
};

export function loadLibrary(db: Db, now: number, { timezone, historyStart }: { timezone: string; historyStart?: string | null }): LibrarySnapshot {
  const stats = new Map<string, SongStats & SongMeta>();
  const rows = db.all<{
    song_key: string;
    uri: string;
    name: string;
    artist: string;
    album: string | null;
    album_art_url: string | null;
    plays: number;
    listens: number;
    last_listen: number | null;
    last_play: number;
    finished: number;
    finish_known: number;
  }>(sql`
    select t.song_key, max(t.uri) as uri, max(t.name) as name, max(t.artist) as artist, max(t.album) as album, max(t.album_art_url) as album_art_url,
      count(*) as plays,
      sum(${LISTEN}) as listens,
      max(case when ${LISTEN} then p.ts end) as last_listen,
      max(p.ts) as last_play,
      sum(${FINISHED}) as finished,
      sum(${FINISH_KNOWN}) as finish_known
    from ${MUSIC}
    where p.kind = 'track'
    group by t.song_key`);
  for (const r of rows) {
    stats.set(r.song_key, {
      uri: r.uri,
      songKey: r.song_key,
      name: r.name,
      artist: r.artist,
      album: r.album,
      albumArtUrl: r.album_art_url,
      plays: r.plays,
      listens: r.listens,
      lastListen: r.last_listen,
      lastPlay: r.last_play,
      finished: r.finished,
      finishKnown: r.finish_known,
    });
  }
  const statsOf = (key: string): SongStats | null => {
    const s = stats.get(key);
    return s ? { plays: s.plays, listens: s.listens, lastListen: s.lastListen, lastPlay: s.lastPlay, finished: s.finished, finishKnown: s.finishKnown } : null;
  };
  const entry = (meta: SongMeta, where: LibraryEntry["where"], addedAt: number | null, positions: number[]): LibraryEntry => {
    const s = statsOf(meta.songKey);
    return { ...meta, where, addedAt, positions, stats: s, class: playClass(s?.lastListen ?? null, now) };
  };
  const first = db.all<{ day: string | null }>(sql`select min(day) as day from plays where kind = 'track'`)[0]?.day ?? null;

  const liked = db
    .all<{ uri: string; added_at: number; song_key: string; name: string; artist: string; album: string | null; album_art_url: string | null }>(sql`
      select s.uri, s.added_at, t.song_key, t.name, t.artist, t.album, t.album_art_url from saved_tracks s join tracks t on t.uri = s.uri order by s.added_at`)
    .map((r) => entry({ uri: r.uri, songKey: r.song_key, name: r.name, artist: r.artist, album: r.album, albumArtUrl: r.album_art_url }, { kind: "liked" }, r.added_at, []));

  const appOwned = new Set(appOwnedPlaylistIds(db));
  const playlists = db
    .all<{ id: string; name: string; item_count: number }>(sql`select id, name, item_count from owned_playlists order by name collate nocase`)
    .filter((p) => !appOwned.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, itemCount: p.item_count }));
  const names = new Map(playlists.map((p) => [p.id, p.name]));
  const items = db.all<{ playlist_id: string; position: number; uri: string; added_at: number | null; song_key: string; name: string; artist: string; album: string | null; album_art_url: string | null }>(sql`
    select i.playlist_id, i.position, i.uri, i.added_at, t.song_key, t.name, t.artist, t.album, t.album_art_url
    from playlist_items i join tracks t on t.uri = i.uri order by i.playlist_id, i.position`);
  const grouped = new Map<string, (typeof items)[number][]>();
  for (const item of items) {
    if (!names.has(item.playlist_id)) continue;
    const key = `${item.playlist_id}|${item.song_key}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  const playlistEntries = [...grouped.values()].map((group) => {
    const head = group[0]!;
    return entry(
      { uri: head.uri, songKey: head.song_key, name: head.name, artist: head.artist, album: head.album, albumArtUrl: head.album_art_url },
      { kind: "playlist", id: head.playlist_id, name: names.get(head.playlist_id)! },
      head.added_at,
      group.map((g) => g.position),
    );
  });
  return { now, timezone, historyStart: historyStart ?? first, liked, playlists, playlistEntries, stats, savedKeys: new Set(liked.map((l) => l.songKey)) };
}

type ClassCounts = Record<PlayClass, number>;

const emptyCounts = (): ClassCounts => ({ active: 0, fading: 0, dormant: 0, never: 0 });

function countClasses(entries: LibraryEntry[]): ClassCounts {
  const counts = emptyCounts();
  for (const e of entries) counts[e.class]++;
  return counts;
}

const iso = (ts: number | null) => (ts === null ? null : new Date(ts).toISOString());
const month = (ts: number, timezone: string) => localTime(ts, timezone).day.slice(0, 7);

export function unsavedSongs(snapshot: LibrarySnapshot) {
  return [...snapshot.stats.values()]
    .filter((s) => s.listens >= CLASS_RULES.unsavedMinListens && !snapshot.savedKeys.has(s.songKey))
    .sort((a, b) => b.listens - a.listens || a.songKey.localeCompare(b.songKey));
}

export function libraryAnalysis(snapshot: LibrarySnapshot) {
  const { liked, playlistEntries, timezone } = snapshot;
  const months = new Map<string, ClassCounts>();
  for (const e of liked) {
    const m = month(e.addedAt!, timezone);
    const counts = months.get(m) ?? emptyCounts();
    counts[e.class]++;
    months.set(m, counts);
  }
  const artists = new Map<string, LibraryEntry[]>();
  for (const e of liked) artists.set(e.artist, [...(artists.get(e.artist) ?? []), e]);
  const idle = (c: ClassCounts) => c.dormant + c.never;

  const byPlaylist = new Map<string, LibraryEntry[]>();
  for (const e of playlistEntries) if (e.where.kind === "playlist") byPlaylist.set(e.where.id, [...(byPlaylist.get(e.where.id) ?? []), e]);
  const keys = new Map([...byPlaylist].map(([id, entries]) => [id, new Set(entries.map((e) => e.songKey))]));
  const overlaps: { a: string; b: string; shared: number }[] = [];
  const ids = [...keys.keys()];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [keys.get(ids[i]!)!, keys.get(ids[j]!)!];
      let shared = 0;
      for (const k of a) if (b.has(k)) shared++;
      if (shared > 0) overlaps.push({ a: ids[i]!, b: ids[j]!, shared });
    }
  overlaps.sort((x, y) => y.shared - x.shared || x.a.localeCompare(y.a));
  const name = (id: string) => snapshot.playlists.find((p) => p.id === id)!.name;

  const unsaved = unsavedSongs(snapshot);
  return {
    historyStart: snapshot.historyStart,
    rules: CLASS_RULES,
    liked: { total: liked.length, classes: countClasses(liked) },
    savedMonths: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([m, counts]) => ({ month: m, ...counts })),
    artists: [...artists]
      .map(([artist, entries]) => ({ artist, total: entries.length, ...countClasses(entries) }))
      .filter((a) => idle(a) > 0)
      .sort((a, b) => idle(b) - idle(a) || b.total - a.total || a.artist.localeCompare(b.artist))
      .slice(0, 12),
    playlists: snapshot.playlists.map((p) => {
      const entries = byPlaylist.get(p.id) ?? [];
      const items = entries.reduce((n, e) => n + e.positions.length, 0);
      const lastListen = entries.reduce<number | null>((max, e) => (e.stats?.lastListen && (max === null || e.stats.lastListen > max) ? e.stats.lastListen : max), null);
      const top = overlaps.find((o) => o.a === p.id || o.b === p.id);
      const other = top ? (top.a === p.id ? top.b : top.a) : null;
      return {
        id: p.id,
        name: p.name,
        items,
        songs: entries.length,
        duplicates: items - entries.length,
        classes: countClasses(entries),
        lastPlayed: iso(lastListen),
        overlap: top && other ? { id: other, name: name(other), shared: top.shared } : null,
      };
    }),
    overlaps: overlaps.slice(0, 10).map((o) => ({ a: { id: o.a, name: name(o.a) }, b: { id: o.b, name: name(o.b) }, shared: o.shared })),
    unsaved: {
      total: unsaved.length,
      songs: unsaved.slice(0, 8).map((s) => ({ songKey: s.songKey, uri: s.uri, name: s.name, artist: s.artist, albumArtUrl: s.albumArtUrl, listens: s.listens, lastPlayed: iso(s.lastPlay) })),
    },
  };
}

export const songGroup = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("songs"),
    where: z.string().min(1).max(64).describe("'liked' or a playlist id"),
    classes: z.array(z.enum(PLAY_CLASSES)).min(1).optional(),
    artist: z.string().min(1).max(200).optional(),
    savedMonth: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  }),
  z.strictObject({ kind: z.literal("duplicates"), where: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("unsaved") }),
]);

export type SongGroup = z.infer<typeof songGroup>;

const BY_DORMANCY = (a: LibraryEntry, b: LibraryEntry) =>
  (a.stats?.lastListen ?? 0) - (b.stats?.lastListen ?? 0) || (a.addedAt ?? 0) - (b.addedAt ?? 0) || a.songKey.localeCompare(b.songKey);

/** The songs behind one figure of the analysis. Unknown playlists and app-owned ones give no songs. */
export function groupEntries(snapshot: LibrarySnapshot, group: SongGroup): LibraryEntry[] {
  if (group.kind === "unsaved") {
    return unsavedSongs(snapshot).map((s) => ({
      uri: s.uri,
      songKey: s.songKey,
      name: s.name,
      artist: s.artist,
      album: s.album,
      albumArtUrl: s.albumArtUrl,
      where: { kind: "liked" },
      addedAt: null,
      positions: [],
      stats: { plays: s.plays, listens: s.listens, lastListen: s.lastListen, lastPlay: s.lastPlay, finished: s.finished, finishKnown: s.finishKnown },
      class: playClass(s.lastListen, snapshot.now),
    }));
  }
  const pool = group.where === "liked" ? snapshot.liked : snapshot.playlistEntries.filter((e) => e.where.kind === "playlist" && e.where.id === group.where);
  if (group.kind === "duplicates") return pool.filter((e) => e.positions.length > 1);
  return pool
    .filter(
      (e) =>
        (!group.classes || group.classes.includes(e.class)) &&
        (!group.artist || e.artist === group.artist) &&
        (!group.savedMonth || (e.addedAt !== null && month(e.addedAt, snapshot.timezone) === group.savedMonth)),
    )
    .sort(BY_DORMANCY);
}

const monthYear = (ts: number, timezone: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: timezone }).format(ts);
const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/** The evidence behind an entry, in plain words. */
export function plainReason(snapshot: LibrarySnapshot, e: LibraryEntry): string {
  const tz = snapshot.timezone;
  const s = e.stats;
  if (!s || s.listens === 0) {
    const started = s?.plays ? `, started ${times(s.plays)} but never past 30 seconds` : "";
    const savedBeforeHistory = e.addedAt !== null && snapshot.historyStart !== null && localTime(e.addedAt, tz).day < snapshot.historyStart;
    const since = savedBeforeHistory ? ` since ${monthYear(Date.parse(`${snapshot.historyStart}T12:00:00Z`), tz)}` : "";
    return `Never played${since}${started}`;
  }
  return `Last played ${monthYear(s.lastListen!, tz)}, ${s.listens === 1 ? "1 listen" : `${s.listens} listens`} in all`;
}

export function entryEvidence(e: LibraryEntry) {
  const s = e.stats;
  return {
    name: e.name,
    artist: e.artist,
    album: e.album,
    albumArtUrl: e.albumArtUrl,
    songKey: e.songKey,
    plays: s?.plays ?? 0,
    listens: s?.listens ?? 0,
    lastPlayed: iso(s?.lastListen ?? null),
    finishedShare: s && s.finishKnown > 0 ? Math.round((s.finished / s.finishKnown) * 100) / 100 : null,
    addedAt: iso(e.addedAt),
    playClass: e.class,
  };
}
