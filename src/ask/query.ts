import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { dayTypeSql, HOUR_BUCKET, LISTEN, OUTCOME, OUTCOME_WORDS, PLAY_OUTCOMES, SHUFFLE, SKIP_KNOWN, SKIPPED, periodExpr } from "../analytics/common";
import type { Db } from "../db/client";
import { DEVICES, PLAY_SOURCES } from "../db/schema";
import { GENRES, MOODS } from "../tags/vocabulary";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const GROUPS = ["year", "month", "week", "day", "weekday", "hour", "hourBucket", "dayType", "artist", "song", "album", "device", "country", "genre", "mood", "language", "source", "shuffle"] as const;
export const METRICS = ["plays", "listens", "hours", "skips", "skipRate", "uniqueSongs", "uniqueArtists", "firstPlayed", "lastPlayed"] as const;

export const queryPlaysInput = z.strictObject({
  from: day.optional().describe("First local day, inclusive (YYYY-MM-DD)."),
  to: day.optional().describe("Last local day, inclusive."),
  artists: z.array(z.string()).max(20).optional().describe("Exact artist names."),
  songKeys: z.array(z.string()).max(50).optional(),
  text: z.string().max(100).optional().describe("Case-insensitive substring of song, artist or album."),
  hours: z.array(z.number().int().min(0).max(23)).optional().describe("Local hours 0-23."),
  weekdays: z.array(z.number().int().min(1).max(7)).optional().describe("ISO weekdays, 1 = Monday."),
  devices: z.array(z.enum(DEVICES)).optional(),
  outcomes: z
    .array(z.enum(Object.values(OUTCOME_WORDS) as [string, ...string[]]))
    .optional()
    .describe("Only plays that ended this way. Recently-played API rows, and plays left after 30 seconds of a song with no known length, have no outcome."),
  shuffle: z.boolean().optional(),
  source: z.enum(PLAY_SOURCES).optional(),
  country: z.string().length(2).optional().describe("Two-letter country code (export rows only)."),
  genres: z.array(z.enum(GENRES)).optional().describe("Only plays of songs tagged with any of these genres."),
  moods: z.array(z.enum(MOODS)).optional(),
  groupBy: z.array(z.enum(GROUPS)).max(3).optional().describe("Up to three group keys. genre and mood expand each song into one row per tag, so totals across tags can exceed the real total."),
  metrics: z.array(z.enum(METRICS)).min(1).optional().describe("Default: plays, listens, hours."),
  orderBy: z.enum([...METRICS, ...GROUPS]).optional().describe("A requested metric or group key. Default: the first metric, descending."),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export type QueryPlaysInput = z.infer<typeof queryPlaysInput>;

const groupExpressions = (weekendDays: readonly number[]): Record<(typeof GROUPS)[number], SQL> => ({
  year: sql.raw("substr(p.day, 1, 4)"),
  month: sql.raw("substr(p.day, 1, 7)"),
  week: periodExpr("week"),
  day: sql.raw("p.day"),
  weekday: sql.raw("p.weekday"),
  hour: sql.raw("p.hour"),
  hourBucket: HOUR_BUCKET,
  dayType: dayTypeSql(weekendDays),
  artist: sql.raw("t.artist"),
  song: sql.raw("t.song_key"),
  album: sql.raw("t.album"),
  device: sql.raw("p.device"),
  country: sql.raw("p.conn_country"),
  genre: sql.raw("jg.value"),
  mood: sql.raw("jm.value"),
  language: sql.raw("tg.language"),
  source: sql.raw("p.source"),
  shuffle: SHUFFLE,
});

const METRIC_SQL: Record<(typeof METRICS)[number], SQL> = {
  plays: sql.raw("count(*)"),
  listens: sql`sum(${LISTEN})`,
  hours: sql.raw("round(sum(coalesce(p.ms_played, t.duration_ms, 0)) / 3600000.0, 2)"),
  skips: sql`sum(${SKIPPED})`,
  skipRate: sql`round(1.0 * sum(${SKIPPED}) / nullif(sum(${SKIP_KNOWN}), 0), 3)`,
  uniqueSongs: sql.raw("count(distinct t.song_key)"),
  uniqueArtists: sql.raw("count(distinct t.artist)"),
  firstPlayed: sql.raw("min(p.ts)"),
  lastPlayed: sql.raw("max(p.ts)"),
};

const list = (values: (string | number)[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** Builds a read-only aggregate over music plays from whitelisted fragments; every user value is a bound parameter. */
export function queryPlays(db: Db, input: QueryPlaysInput, weekendDays: readonly number[]) {
  const groupSql = groupExpressions(weekendDays);
  const groups = input.groupBy ?? [];
  const metrics = input.metrics ?? ["plays", "listens", "hours"];
  const where: SQL[] = [sql`p.kind = 'track'`];
  if (input.from) where.push(sql`p.day >= ${input.from}`);
  if (input.to) where.push(sql`p.day <= ${input.to}`);
  if (input.artists?.length) where.push(sql`lower(t.artist) in (${list(input.artists.map((a) => a.toLowerCase()))})`);
  if (input.songKeys?.length) where.push(sql`t.song_key in (${list(input.songKeys)})`);
  if (input.text) {
    const like = `%${input.text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`(lower(t.name) like ${like} escape '\\' or lower(t.artist) like ${like} escape '\\' or lower(t.album) like ${like} escape '\\')`);
  }
  if (input.hours?.length) where.push(sql`p.hour in (${list(input.hours)})`);
  if (input.weekdays?.length) where.push(sql`p.weekday in (${list(input.weekdays)})`);
  if (input.devices?.length) where.push(sql`p.device in (${list(input.devices)})`);
  if (input.outcomes?.length) where.push(sql`${OUTCOME} in (${list(PLAY_OUTCOMES.filter((o) => input.outcomes!.includes(OUTCOME_WORDS[o])))})`);
  if (input.shuffle !== undefined) where.push(sql`p.shuffle = ${input.shuffle ? 1 : 0}`);
  if (input.source) where.push(sql`p.source = ${input.source}`);
  if (input.country) where.push(sql`p.conn_country = ${input.country.toUpperCase()}`);
  if (input.genres?.length) where.push(sql`exists (select 1 from json_each(tg.genres) g where g.value in (${list(input.genres)}))`);
  if (input.moods?.length) where.push(sql`exists (select 1 from json_each(tg.moods) m where m.value in (${list(input.moods)}))`);

  const joins: SQL[] = [sql`plays p join tracks t on t.uri = p.track_uri left join track_tags tg on tg.song_key = t.song_key`];
  if (groups.includes("genre")) joins.push(sql`join json_each(tg.genres) jg`);
  if (groups.includes("mood")) joins.push(sql`join json_each(tg.moods) jm`);

  const selects: SQL[] = groups.map((g) => sql`${groupSql[g]} as ${sql.identifier(g)}`);
  if (groups.includes("song")) selects.push(sql`min(t.name) as name`, sql`min(t.artist) as songArtist`);
  selects.push(...metrics.map((m) => sql`${METRIC_SQL[m]} as ${sql.identifier(m)}`));

  const orderKey = input.orderBy && ([...metrics, ...groups] as string[]).includes(input.orderBy) ? input.orderBy : metrics[0]!;
  const direction = sql.raw(input.order === "asc" ? "asc" : "desc");
  const limit = input.limit ?? 50;
  const query = sql`
    select ${sql.join(selects, sql`, `)}
    from ${sql.join(joins, sql` `)}
    where ${sql.join(where, sql` and `)}
    ${groups.length ? sql`group by ${sql.join(groups.map((g) => groupSql[g]), sql`, `)}` : sql``}
    order by ${sql.identifier(orderKey)} ${direction}
    limit ${limit + 1}`;
  const rows = db.all<Record<string, unknown>>(query);
  const iso = (v: unknown) => (typeof v === "number" ? new Date(v).toISOString() : v);
  return {
    rows: rows.slice(0, limit).map((r) => ({ ...r, ...("firstPlayed" in r ? { firstPlayed: iso(r.firstPlayed) } : {}), ...("lastPlayed" in r ? { lastPlayed: iso(r.lastPlayed) } : {}) })),
    truncated: rows.length > limit,
  };
}
