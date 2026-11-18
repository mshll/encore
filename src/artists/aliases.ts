import { asc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { artistAliases } from "../db/schema";

export type ArtistAlias = { alias: string; canonical: string; createdAt: string };

export type AliasErrorCode = "same_artist" | "unknown_artist" | "already_alias" | "alias_chain" | "not_alias";

export class AliasError extends Error {
  constructor(
    readonly code: AliasErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Keeps `tracks.artist` equal to the canonical artist of each track's credit, holding the credit in
 * `artist_credit` while an alias applies. Every artist aggregation groups by `tracks.artist`, so this one
 * rewrite moves top artists, artist pages, eras, tags, radar and Claude's tools together. Song keys keep the credit.
 */
export function syncAliases(db: DbOrTx): void {
  db.run(sql`update tracks set artist_credit = artist, artist = (select canonical from artist_aliases a where a.alias = tracks.artist)
    where artist in (select alias from artist_aliases)`);
  db.run(sql`update tracks set artist = artist_credit, artist_credit = null
    where artist_credit is not null and artist_credit not in (select alias from artist_aliases)`);
}

const toAlias = (r: typeof artistAliases.$inferSelect): ArtistAlias => ({ alias: r.alias, canonical: r.canonical, createdAt: new Date(r.createdAt).toISOString() });

export function listAliases(db: Db, canonical?: string): ArtistAlias[] {
  const q = db.select().from(artistAliases);
  return (canonical === undefined ? q : q.where(eq(artistAliases.canonical, canonical))).orderBy(asc(artistAliases.alias)).all().map(toAlias);
}

export function canonicalOf(db: Db, name: string): string | null {
  return db.select({ canonical: artistAliases.canonical }).from(artistAliases).where(eq(artistAliases.alias, name)).get()?.canonical ?? null;
}

const played = (db: DbOrTx, artist: string) => db.all(sql`select 1 from tracks where artist = ${artist} limit 1`).length > 0;

/** Counts every track credited to `alias` as `canonical`. Chains are refused: a canonical artist is never an alias. */
export function addAlias(db: Db, alias: string, canonical: string, now = Date.now()): ArtistAlias {
  return db.transaction((tx) => {
    if (alias === canonical) throw new AliasError("same_artist", "An artist cannot count as itself");
    const rows = tx.select().from(artistAliases).all();
    const existing = rows.find((r) => r.alias === alias);
    if (existing) throw new AliasError("already_alias", `${alias} already counts as ${existing.canonical}`);
    const target = rows.find((r) => r.alias === canonical);
    if (target) throw new AliasError("alias_chain", `${canonical} counts as ${target.canonical}; choose ${target.canonical} instead`);
    if (rows.some((r) => r.canonical === alias)) throw new AliasError("alias_chain", `Other artists count as ${alias}; remove those first`);
    if (!played(tx, alias)) throw new AliasError("unknown_artist", `No plays of ${alias}`);
    if (!played(tx, canonical)) throw new AliasError("unknown_artist", `No plays of ${canonical}`);
    tx.insert(artistAliases).values({ alias, canonical, createdAt: now }).run();
    syncAliases(tx);
    return toAlias({ alias, canonical, createdAt: now });
  });
}

/** Undoes an alias: its tracks count as their credited artist again. */
export function removeAlias(db: Db, alias: string): void {
  db.transaction((tx) => {
    const removed = tx.delete(artistAliases).where(eq(artistAliases.alias, alias)).returning().all();
    if (removed.length === 0) throw new AliasError("not_alias", `${alias} does not count as another artist`);
    syncAliases(tx);
  });
}
