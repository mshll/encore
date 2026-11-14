import { sql, type SQL } from "drizzle-orm";

export type Range = { from?: string; to?: string };
export type Period = "day" | "week" | "month" | "year";

export const MS = sql.raw("coalesce(p.ms_played, t.duration_ms, 0)");
export const LISTEN = sql.raw("(p.source = 'api' or p.ms_played >= 30000)");
export const MUSIC = sql.raw("plays p join tracks t on t.uri = p.track_uri");
export const HOUR_BUCKET = sql.raw(
  "case when p.hour < 6 then 'night' when p.hour < 12 then 'morning' when p.hour < 18 then 'afternoon' else 'evening' end",
);
export const DAY_TYPE = sql.raw("case when p.weekday in (5, 6) then 'weekend' else 'weekday' end");
export const START_MODE = sql.raw(
  "case when p.reason_start in ('clickrow', 'playbtn', 'backbtn') then 'chosen' when p.reason_start in ('trackdone', 'fwdbtn') then 'auto' end",
);
export const SHUFFLE = sql.raw("case p.shuffle when 1 then 'on' when 0 then 'off' end");

export const STATS = sql.raw(`count(*) as plays,
  coalesce(sum(p.source = 'api' or p.ms_played >= 30000), 0) as listens,
  coalesce(sum(coalesce(p.ms_played, t.duration_ms, 0)), 0) as ms,
  coalesce(sum(p.skipped = 1), 0) as skips,
  coalesce(sum(p.skipped is not null), 0) as skip_known,
  coalesce(sum(p.skipped = 1 and p.ms_played < 5000), 0) as quick_skips,
  min(p.ts) as first_ts,
  max(p.ts) as last_ts`);

export type StatsRow = {
  plays: number;
  listens: number;
  ms: number;
  skips: number;
  skip_known: number;
  quick_skips: number;
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
    select song_key, uri, name, artist, album, album_art_url, plays, listens, ms, skips, skip_known, quick_skips, first_ts, last_ts from (
      select t.song_key, t.uri, t.name, t.artist, t.album, t.album_art_url,
        row_number() over w_rank as rn,
        sum(count(*)) over w as plays,
        sum(coalesce(sum(p.source = 'api' or p.ms_played >= 30000), 0)) over w as listens,
        sum(coalesce(sum(coalesce(p.ms_played, t.duration_ms, 0)), 0)) over w as ms,
        sum(coalesce(sum(p.skipped = 1), 0)) over w as skips,
        sum(coalesce(sum(p.skipped is not null), 0)) over w as skip_known,
        sum(coalesce(sum(p.skipped = 1 and p.ms_played < 5000), 0)) over w as quick_skips,
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
    quickSkips: row.quick_skips,
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

export const songWithStats = (row: SongRow) => ({ ...song(row), ...stats(row) });
