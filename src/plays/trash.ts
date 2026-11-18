import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { plays } from "../db/schema";
import type { Range } from "../analytics/common";

export type PlayKeyInput = { dedupeKey: string; source: string; trackUri?: string | null; ts: number; msPlayed?: number | null };

const COLUMNS = sql.raw(
  Object.values(getTableColumns(plays))
    .map((c) => c.name)
    .join(", "),
);

const idList = (ids: number[]) =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

const chunkSize = 500;

function inChunks(ids: number[], run: (chunk: number[]) => number): number {
  let n = 0;
  for (let i = 0; i < ids.length; i += chunkSize) n += run(ids.slice(i, i + chunkSize));
  return n;
}

/**
 * Moves plays to the trash. Every query reads `plays`, so a trashed play leaves every total, list, recap and
 * Claude tool at once. A tombstone per play keeps ingest from storing it again.
 */
export function trashPlays(db: Db, ids: number[], now = Date.now()): number {
  const unique = [...new Set(ids)];
  return db.transaction((tx) =>
    inChunks(unique, (chunk) => {
      tx.run(sql`insert or replace into play_tombstones (dedupe_key, source, track_uri, ts, ms_played, deleted_at)
        select dedupe_key, source, track_uri, ts, ms_played, ${now} from plays where id in (${idList(chunk)})`);
      tx.run(sql`insert into play_trash (${COLUMNS}, trashed_at) select ${COLUMNS}, ${now} from plays where id in (${idList(chunk)})`);
      return tx.all<{ id: number }>(sql`delete from plays where id in (${idList(chunk)}) returning id`).length;
    }),
  );
}

/** Every play of a song in the range: the ids `trashPlays` takes. */
export function songPlayIds(db: Db, songKey: string, range: Range): number[] {
  const parts: SQL[] = [sql`t.song_key = ${songKey}`];
  if (range.from) parts.push(sql`p.day >= ${range.from}`);
  if (range.to) parts.push(sql`p.day <= ${range.to}`);
  return db.all<{ id: number }>(sql`select p.id from plays p join tracks t on t.uri = p.track_uri where ${sql.join(parts, sql` and `)}`).map((r) => r.id);
}

/** Moves trashed plays back, with their ids, and lifts their tombstones. */
export function restorePlays(db: Db, ids: number[]): number {
  const unique = [...new Set(ids)];
  return db.transaction((tx) =>
    inChunks(unique, (chunk) => {
      tx.run(sql`delete from play_tombstones where dedupe_key in (select dedupe_key from play_trash where id in (${idList(chunk)}))`);
      tx.run(sql`insert into plays (${COLUMNS}) select ${COLUMNS} from play_trash where id in (${idList(chunk)})`);
      return tx.all<{ id: number }>(sql`delete from play_trash where id in (${idList(chunk)}) returning id`).length;
    }),
  );
}

/** Deletes trashed plays for good. Their tombstones stay, so they never come back. */
export function emptyTrash(db: Db): number {
  return db.all<{ id: number }>(sql`delete from play_trash returning id`).length;
}

export function trashCount(db: Db): number {
  return db.all<{ n: number }>(sql`select count(*) as n from play_trash`)[0]!.n;
}

export function tombstonedKeys(db: DbOrTx, keys: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    for (const r of db.all<{ k: string }>(sql`select dedupe_key as k from play_tombstones where dedupe_key in (${sql.join(
      chunk.map((k) => sql`${k}`),
      sql`, `,
    )})`))
      out.add(r.k);
  }
  return out;
}
