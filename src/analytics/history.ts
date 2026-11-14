import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Device, PlayKind, PlaySource } from "../db/schema";
import type { Range } from "./common";

export type HistoryFilters = {
  range: Range;
  kind?: PlayKind;
  artist?: string;
  songKey?: string;
  uri?: string;
  device?: Device;
  skipped?: boolean;
  country?: string;
  source?: PlaySource;
  q?: string;
  limit: number;
  offset: number;
};

type Row = {
  id: number;
  ts: number;
  day: string;
  hour: number;
  kind: PlayKind;
  uri: string | null;
  song_key: string | null;
  name: string | null;
  artist: string | null;
  album: string | null;
  album_art_url: string | null;
  ms_played: number | null;
  skipped: number | null;
  shuffle: number | null;
  reason_start: string | null;
  reason_end: string | null;
  device: Device;
  conn_country: string | null;
  source: PlaySource;
};

const bool = (v: number | null) => (v == null ? null : v === 1);

export function history(db: Db, f: HistoryFilters) {
  const parts: SQL[] = [sql`p.kind = ${f.kind ?? "track"}`];
  if (f.range.from) parts.push(sql`p.day >= ${f.range.from}`);
  if (f.range.to) parts.push(sql`p.day <= ${f.range.to}`);
  if (f.artist) parts.push(sql`t.artist = ${f.artist}`);
  if (f.songKey) parts.push(sql`t.song_key = ${f.songKey}`);
  if (f.uri) parts.push(sql`p.track_uri = ${f.uri}`);
  if (f.device) parts.push(sql`p.device = ${f.device}`);
  if (f.skipped !== undefined) parts.push(sql`p.skipped = ${f.skipped ? 1 : 0}`);
  if (f.country) parts.push(sql`p.conn_country = ${f.country}`);
  if (f.source) parts.push(sql`p.source = ${f.source}`);
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    parts.push(sql`(t.name like ${like} escape '\\' or t.artist like ${like} escape '\\' or t.album like ${like} escape '\\' or p.episode_name like ${like} escape '\\' or p.show_name like ${like} escape '\\')`);
  }
  const where = sql.join(parts, sql` and `);
  const from = sql`plays p left join tracks t on t.uri = p.track_uri`;
  const rows = db.all<Row>(sql`
    select p.id, p.ts, p.day, p.hour, p.kind, coalesce(p.track_uri, p.episode_uri) as uri, t.song_key,
      coalesce(t.name, p.episode_name) as name, coalesce(t.artist, p.show_name) as artist, t.album, t.album_art_url,
      p.ms_played, p.skipped, p.shuffle, p.reason_start, p.reason_end, p.device, p.conn_country, p.source
    from ${from} where ${where} order by p.ts desc, p.id desc limit ${f.limit} offset ${f.offset}`);
  const total = db.all<{ n: number }>(sql`select count(*) as n from ${from} where ${where}`)[0]!.n;
  return {
    total,
    limit: f.limit,
    offset: f.offset,
    items: rows.map((r) => ({
      id: r.id,
      ts: new Date(r.ts).toISOString(),
      day: r.day,
      hour: r.hour,
      kind: r.kind,
      uri: r.uri,
      songKey: r.song_key,
      name: r.name,
      artist: r.artist,
      album: r.album,
      albumArtUrl: r.album_art_url,
      msPlayed: r.ms_played,
      skipped: bool(r.skipped),
      shuffle: bool(r.shuffle),
      reasonStart: r.reason_start,
      reasonEnd: r.reason_end,
      device: r.device,
      country: r.conn_country,
      source: r.source,
    })),
  };
}
