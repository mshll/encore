import { and, eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { blocks } from "../db/schema";

export type BlockKind = "song" | "artist";

export const artistKey = (artist: string) => artist.trim().toLowerCase();

export function addBlock(db: DbOrTx, kind: BlockKind, key: string, label: string, reason: string, now: number) {
  db.insert(blocks).values({ kind, key, label, reason, createdAt: now }).onConflictDoNothing().run();
}

export function removeBlock(db: DbOrTx, kind: BlockKind, key: string) {
  db.delete(blocks).where(and(eq(blocks.kind, kind), eq(blocks.key, key))).run();
}

export function listBlocks(db: Db) {
  return db.select().from(blocks).orderBy(blocks.kind, blocks.label).all();
}

export function blockedSets(db: Db) {
  const rows = listBlocks(db);
  return {
    songs: new Set(rows.filter((r) => r.kind === "song").map((r) => r.key)),
    artists: new Set(rows.filter((r) => r.kind === "artist").map((r) => r.key)),
  };
}

export type Blocked = ReturnType<typeof blockedSets>;

export const isBlocked = (b: Blocked, songKey: string, artists: string[]) => b.songs.has(songKey) || artists.some((a) => b.artists.has(artistKey(a)));
