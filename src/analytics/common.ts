import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";

export type Range = { from?: string; to?: string };
export type Period = "day" | "week" | "month" | "year";

export const MS = sql.raw("coalesce(p.ms_played, t.duration_ms, 0)");

/**
 * How a track play ended. A skip is the owner pressing next before the outro: `early` within the first
 * `earlyMs`, `midway` after it. Leaving within the outro counts as played through, and going back, choosing
 * another song, closing the app or an error is no skip at all (`interrupted`).
 */
export const PLAY_OUTCOMES = ["through", "early", "midway", "interrupted"] as const;
export type PlayOutcome = (typeof PLAY_OUTCOMES)[number];
export const SKIP_OUTCOMES: readonly PlayOutcome[] = ["early", "midway"];

/** The outro starts at `throughShare` of the song or `outroMs` before its end, whichever comes first, but never inside the first `earlyMs`. */
export const OUTCOME_RULES = { throughShare: 0.8, outroMs: 30_000, earlyMs: 30_000 } as const;
/** @deprecated The share half of the outro rule; use `OUTCOME_RULES`. */
export const FINISHED_SHARE = OUTCOME_RULES.throughShare;

const { throughShare, outroMs, earlyMs } = OUTCOME_RULES;

export type OutcomeInput = { reasonEnd: string | null; msPlayed: number | null; durationMs: number | null };

/**
 * The single definition of a play's outcome; `OUTCOME` is the same rule in SQL. Null when it can't be told:
 * no reason recorded (recently-played API rows), or next pressed after `earlyMs` on a song of unknown length.
 */
export function playOutcome({ reasonEnd, msPlayed, durationMs }: OutcomeInput): PlayOutcome | null {
  if (reasonEnd === "trackdone") return "through";
  if (reasonEnd === null) return null;
  if (reasonEnd !== "fwdbtn") return "interrupted";
  if (msPlayed === null) return null;
  const known = durationMs !== null && durationMs > 0;
  if (known && msPlayed >= Math.min(throughShare * durationMs, Math.max(earlyMs, durationMs - outroMs))) return "through";
  if (msPlayed < earlyMs) return "early";
  return known ? "midway" : null;
}

/** The outcomes in the words Claude and the owner read. */
export const OUTCOME_WORDS: Record<PlayOutcome, string> = { through: "played through", early: "skipped early", midway: "skipped midway", interrupted: "interrupted" };

export const isSkip = (outcome: PlayOutcome | null): boolean => outcome !== null && SKIP_OUTCOMES.includes(outcome);

const OUTCOME_SQL = `(case
  when p.reason_end = 'trackdone' then 'through'
  when p.reason_end is null then null
  when p.reason_end != 'fwdbtn' then 'interrupted'
  when p.ms_played is null then null
  when t.duration_ms > 0 and p.ms_played >= min(${throughShare} * t.duration_ms, max(${earlyMs}, t.duration_ms - ${outroMs})) then 'through'
  when p.ms_played < ${earlyMs} then 'early'
  when t.duration_ms > 0 then 'midway'
end)`;
const LISTEN_SQL = "(p.source = 'api' or p.ms_played >= 30000)";
const SKIPPED_SQL = `(${OUTCOME_SQL} in ('early', 'midway'))`;
const SKIP_KNOWN_SQL = `(${OUTCOME_SQL} is not null)`;
const EARLY_SQL = `(${OUTCOME_SQL} = 'early')`;
const FINISHED_SQL = `(${OUTCOME_SQL} = 'through')`;

/**
 * The shared play outcomes over `plays p join tracks t`. Use these instead of writing a listen, skip or played-through test inline.
 * `SKIPPED` is a skip by `playOutcome` (early or midway), `FINISHED` played through, and `SKIP_KNOWN`/`FINISH_KNOWN` a play
 * whose outcome is known: the denominator of both rates.
 */
export const OUTCOME = sql.raw(OUTCOME_SQL);
export const LISTEN = sql.raw(LISTEN_SQL);
export const SKIPPED = sql.raw(SKIPPED_SQL);
export const SKIP_KNOWN = sql.raw(SKIP_KNOWN_SQL);
export const EARLY_SKIP = sql.raw(EARLY_SQL);
export const FINISHED = sql.raw(FINISHED_SQL);
export const FINISH_KNOWN = SKIP_KNOWN;
export const MUSIC = sql.raw("plays p join tracks t on t.uri = p.track_uri");
export const HOUR_BUCKET = sql.raw(
  "case when p.hour < 6 then 'night' when p.hour < 12 then 'morning' when p.hour < 18 then 'afternoon' else 'evening' end",
);
/** `weekend` on the owner's weekend days (ISO weekdays), else `weekday`. */
export function dayTypeSql(weekendDays: readonly number[]): SQL {
  if (weekendDays.length === 0) return sql.raw("'weekday'");
  return sql`case when p.weekday in (${sql.join(
    weekendDays.map((d) => sql`${d}`),
    sql`, `,
  )}) then 'weekend' else 'weekday' end`;
}
export const START_MODE = sql.raw(
  "case when p.reason_start in ('clickrow', 'playbtn', 'backbtn') then 'chosen' when p.reason_start in ('trackdone', 'fwdbtn') then 'auto' end",
);
export const SHUFFLE = sql.raw("case p.shuffle when 1 then 'on' when 0 then 'off' end");

export const STATS = sql.raw(`count(*) as plays,
  coalesce(sum(${LISTEN_SQL}), 0) as listens,
  coalesce(sum(coalesce(p.ms_played, t.duration_ms, 0)), 0) as ms,
  coalesce(sum(${SKIPPED_SQL}), 0) as skips,
  coalesce(sum(${SKIP_KNOWN_SQL}), 0) as skip_known,
  coalesce(sum(${EARLY_SQL}), 0) as early_skips,
  min(p.ts) as first_ts,
  max(p.ts) as last_ts`);

export type StatsRow = {
  plays: number;
  listens: number;
  ms: number;
  skips: number;
  skip_known: number;
  early_skips: number;
  first_ts: number | null;
  last_ts: number | null;
};

export function musicWhere(range: Range, ...extra: (SQL | undefined)[]): SQL {
  const parts: SQL[] = [sql`p.kind = 'track'`];
  if (range.from) parts.push(sql`p.day >= ${range.from}`);
  if (range.to) parts.push(sql`p.day <= ${range.to}`);
  for (const e of extra) if (e) parts.push(e);
  return sql.join(parts, sql` and `);
}

export const containsPattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function periodExpr(period: Period): SQL {
  switch (period) {
    case "day":
      return sql.raw("p.day");
    case "week":
      return sql.raw("date(p.day, '-' || (p.weekday - 1) || ' days')");
    case "month":
      return sql.raw("substr(p.day, 1, 7)");
    case "year":
      return sql.raw("substr(p.day, 1, 4)");
  }
}

export function songStatsSql(where: SQL): SQL {
  return sql`
    select song_key, uri, name, artist, album, album_art_url, plays, listens, ms, skips, skip_known, early_skips, first_ts, last_ts from (
      select t.song_key, t.uri, t.name, t.artist, t.album,
        max(max(t.album_art_url)) over w as album_art_url,
        row_number() over w_rank as rn,
        sum(count(*)) over w as plays,
        sum(coalesce(sum(${LISTEN}), 0)) over w as listens,
        sum(coalesce(sum(coalesce(p.ms_played, t.duration_ms, 0)), 0)) over w as ms,
        sum(coalesce(sum(${SKIPPED}), 0)) over w as skips,
        sum(coalesce(sum(${SKIP_KNOWN}), 0)) over w as skip_known,
        sum(coalesce(sum(${EARLY_SKIP}), 0)) over w as early_skips,
        min(min(p.ts)) over w as first_ts,
        max(max(p.ts)) over w as last_ts
      from ${MUSIC}
      where ${where}
      group by t.uri
      window w as (partition by t.song_key), w_rank as (partition by t.song_key order by count(*) desc, t.uri)
    ) where rn = 1`;
}

export type SongRow = StatsRow & {
  song_key: string;
  uri: string;
  name: string;
  artist: string;
  album: string | null;
  album_art_url: string | null;
};

export const hours = (ms: number) => Math.round(ms / 36_000) / 100;
export const rate = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : null);
export const iso = (ts: number | null | undefined) => (ts == null ? null : new Date(ts).toISOString());

export function stats(row: StatsRow) {
  return {
    hours: hours(row.ms),
    plays: row.plays,
    listens: row.listens,
    skips: row.skips,
    skipRate: rate(row.skips, row.skip_known),
    earlySkips: row.early_skips,
    firstPlayed: iso(row.first_ts),
    lastPlayed: iso(row.last_ts),
  };
}

export function song(row: SongRow) {
  return {
    songKey: row.song_key,
    uri: row.uri,
    name: row.name,
    artist: row.artist,
    album: row.album,
    albumArtUrl: row.album_art_url,
  };
}

export function withArtistImages<T extends { artist: string }>(db: Db, rows: T[]): (T & { imageUrl: string | null })[] {
  const names = [...new Set(rows.map((r) => r.artist))];
  if (names.length === 0) return [];
  const images = db.all<{ artist: string; image_url: string }>(sql`
    select t.artist, max(a.image_url) as image_url from tracks t
    join track_artists ta on ta.track_uri = t.uri and ta.position = 0
    join artists a on a.id = ta.artist_id
    where a.image_url is not null and t.artist in (${sql.join(
      names.map((n) => sql`${n}`),
      sql`, `,
    )})
    group by t.artist`);
  const byName = new Map(images.map((i) => [i.artist, i.image_url]));
  return rows.map((r) => ({ ...r, imageUrl: byName.get(r.artist) ?? null }));
}

export const songWithStats = (row: SongRow) => ({ ...song(row), ...stats(row) });
