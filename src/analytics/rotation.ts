import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { localTime } from "../plays/localTime";
import { hours, LISTEN, MS, MUSIC, musicWhere, type Range, songIdentities } from "./common";

/** A song stays in rotation while each listen day comes within `gapDays` of the one before. */
export const ROTATION_RULES = { gapDays: 30 } as const;
/** Run lengths in days, inclusive; the last bucket is open. */
const BUCKETS: [number, number | null][] = [
  [1, 1],
  [2, 7],
  [8, 30],
  [31, 90],
  [91, 365],
  [366, null],
];

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

type Run = { songKey: string; from: string; to: string; days: number; activeDays: number; listens: number; ongoing: boolean };

/**
 * Songs first listened to in the range, and how long each stayed: its first run starts on its first listen day and ends at
 * the last listen day before a gap of more than `gapDays`. A song with listens on two days or more of its run entered rotation.
 */
export function stayingPower(db: Db, { range, today, limit }: { range: Range; today: string; limit: number }) {
  const rows = db.all<{ song_key: string; day: string; listens: number }>(sql`
    select t.song_key, p.day, count(*) as listens from ${MUSIC} where ${musicWhere({})} and ${LISTEN}
    group by t.song_key, p.day order by t.song_key, p.day`);
  const runs: Run[] = [];
  for (let i = 0; i < rows.length; ) {
    const key = rows[i]!.song_key;
    const first = rows[i]!.day;
    let to = first;
    let activeDays = 0;
    let listens = 0;
    let ended = false;
    for (; i < rows.length && rows[i]!.song_key === key; i++) {
      const r = rows[i]!;
      if (ended || daysBetween(to, r.day) > ROTATION_RULES.gapDays) {
        ended = true;
        continue;
      }
      to = r.day;
      activeDays++;
      listens += r.listens;
    }
    const inRange = (!range.from || first >= range.from) && (!range.to || first <= range.to);
    if (inRange) runs.push({ songKey: key, from: first, to, days: daysBetween(first, to) + 1, activeDays, listens, ongoing: !ended && daysBetween(to, today) <= ROTATION_RULES.gapDays });
  }
  const rotation = runs.filter((r) => r.activeDays >= 2);
  const longest = rotation.sort((a, b) => b.days - a.days || b.listens - a.listens || a.songKey.localeCompare(b.songKey)).slice(0, limit);
  const byKey = songIdentities(db, longest.map((r) => r.songKey));
  return {
    rules: ROTATION_RULES,
    songs: runs.length,
    inRotation: rotation.length,
    medianDays: median(rotation.map((r) => r.days)),
    medianActiveDays: median(rotation.map((r) => r.activeDays)),
    buckets: BUCKETS.map(([from, to]) => ({ from, to, songs: runs.filter((r) => r.days >= from && (to === null || r.days <= to)).length })),
    longest: longest.map((r) => {
      return { ...byKey.get(r.songKey)!, from: r.from, to: r.to, days: r.days, activeDays: r.activeDays, listens: r.listens, ongoing: r.ongoing };
    }),
  };
}

export const FIND_SOURCES = ["picks", "sets", "releases"] as const;
export type FindSource = (typeof FIND_SOURCES)[number];

type Suggestion = { song_key: string; at: number; source: FindSource; uri: string; name: string; artist: string; album_art_url: string | null };

/**
 * Songs encore suggested (weekly picks, new songs in sets, the tracks of releases in New from your artists) that were new to
 * the owner then, and what was listened to after. A song suggested more than once counts from its first suggestion.
 */
export function encoreFinds(db: Db, { range, timezone, limit }: { range: Range; timezone: string; limit: number }) {
  const suggestions = db.all<Suggestion>(sql`
    select song_key, created_at as at, 'picks' as source, uri, name, artist, album_art_url from picks
    union all
    select si.song_key, coalesce(added.at, s.created_at) as at, 'sets' as source, si.uri, si.name, si.artist, si.album_art_url
    from set_items si join sets s on s.id = si.set_id
    left join (
      select sc.set_id, json_extract(a.value, '$.songKey') as song_key, min(sc.created_at) as at
      from set_changes sc, json_each(sc.added) a group by sc.set_id, song_key
    ) added on added.set_id = si.set_id and added.song_key = si.song_key
    where si.kind = 'new'
    union all
    select rt.song_key, r.first_seen_at as at, 'releases' as source, rt.uri, rt.name, rt.artist, r.image_url as album_art_url
    from release_tracks rt join releases r on r.id = rt.release_id`);
  const first = new Map<string, Suggestion & { sources: Set<FindSource> }>();
  for (const s of suggestions) {
    const seen = first.get(s.song_key);
    if (!seen) first.set(s.song_key, { ...s, sources: new Set([s.source]) });
    else {
      seen.sources.add(s.source);
      if (s.at < seen.at) Object.assign(seen, { ...s, sources: seen.sources });
    }
  }
  const dayOf = (ts: number) => localTime(ts, timezone).day;
  const inRange = (day: string) => (!range.from || day >= range.from) && (!range.to || day <= range.to);
  const picked = [...first.values()].filter((s) => inRange(dayOf(s.at)));
  const plays = picked.length
    ? db.all<{ song_key: string; ts: number; day: string; ms: number; listen: number }>(sql`
        select t.song_key, p.ts, p.day, ${MS} as ms, ${LISTEN} as listen from ${MUSIC}
        where ${musicWhere({})} and t.song_key in (${sql.join(
          picked.map((s) => sql`${s.song_key}`),
          sql`, `,
        )})`)
    : [];
  const bySong = new Map<string, typeof plays>();
  for (const p of plays) bySong.set(p.song_key, [...(bySong.get(p.song_key) ?? []), p]);
  const fresh = picked.filter((s) => !(bySong.get(s.song_key) ?? []).some((p) => p.ts <= s.at && p.listen));
  const items = fresh
    .map((s) => {
      const after = (bySong.get(s.song_key) ?? []).filter((p) => p.ts > s.at);
      const listened = after.filter((p) => p.listen);
      const days = listened.map((p) => p.day).sort();
      return {
        songKey: s.song_key,
        uri: s.uri,
        name: s.name,
        artist: s.artist,
        albumArtUrl: s.album_art_url,
        sources: FIND_SOURCES.filter((x) => s.sources.has(x)),
        suggested: dayOf(s.at),
        listens: listened.length,
        hours: hours(after.reduce((sum, p) => sum + p.ms, 0)),
        firstListen: days[0] ?? null,
        lastListen: days.at(-1) ?? null,
      };
    })
    .filter((i) => i.listens > 0)
    .sort((a, b) => b.listens - a.listens || b.hours - a.hours || a.songKey.localeCompare(b.songKey));
  return {
    suggested: fresh.length,
    heardBefore: picked.length - fresh.length,
    listened: items.length,
    listens: items.reduce((n, i) => n + i.listens, 0),
    hours: items.reduce((n, i) => n + i.hours, 0),
    items: items.slice(0, limit),
  };
}
