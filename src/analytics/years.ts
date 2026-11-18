import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { hours, LISTEN, MS, MUSIC, musicWhere, withArtistImages } from "./common";
import { tagShares } from "./tags";

const TOP = 10;
const TAGS = 8;

const yearSpan = (year: number) => ({ from: `${year}-01-01`, to: `${year}-12-31` });

/** Years with music plays, oldest first. */
export function listeningYears(db: Db): number[] {
  return db.all<{ year: string }>(sql`select distinct substr(p.day, 1, 4) as year from plays p where ${musicWhere({})} order by year`).map((r) => Number(r.year));
}

function side(db: Db, year: number) {
  const span = yearSpan(year);
  const row = db.all<{ ms: number | null; plays: number; listens: number | null; artists: number; songs: number }>(sql`
    select sum(${MS}) as ms, count(*) as plays, sum(${LISTEN}) as listens, count(distinct t.artist) as artists, count(distinct t.song_key) as songs
    from ${MUSIC} where ${musicWhere(span)}`)[0]!;
  const fresh = (column: string) =>
    db.all<{ n: number }>(sql`
      select count(*) as n from (select min(p.day) as first_day from ${MUSIC} where ${musicWhere({})} group by ${sql.raw(column)})
      where first_day between ${span.from} and ${span.to}`)[0]!.n;
  return {
    year,
    hours: hours(row.ms ?? 0),
    plays: row.plays,
    listens: row.listens ?? 0,
    artists: row.artists,
    songs: row.songs,
    newArtists: fresh("t.artist"),
    newSongs: fresh("t.song_key"),
  };
}

function artistRanks(db: Db, year: number): Map<string, { rank: number; hours: number }> {
  const rows = db.all<{ artist: string; ms: number }>(sql`
    select t.artist, sum(${MS}) as ms from ${MUSIC} where ${musicWhere(yearSpan(year))} group by t.artist order by ms desc, t.artist`);
  return new Map(rows.map((r, i) => [r.artist, { rank: i + 1, hours: hours(r.ms) }]));
}

function tagRows(db: Db, column: "genres" | "moods", a: number, b: number) {
  const before = tagShares(db, column, yearSpan(a));
  const now = tagShares(db, column, yearSpan(b));
  const round = (n: number | undefined) => Math.round((n ?? 0) * 1000) / 1000;
  return [...new Set([...before.keys(), ...now.keys()])]
    .map((value) => ({ value, a: round(before.get(value)), b: round(now.get(value)) }))
    .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || x.value.localeCompare(y.value))
    .slice(0, TAGS);
}

/**
 * Two calendar years side by side. `artists` is the union of both years' top ten by hours, each with its rank in both
 * years (among every artist played that year) and `change`: rank in `a` minus rank in `b`, so rising is positive.
 */
export function yearCompare(db: Db, { a, b }: { a: number; b: number }) {
  const ranksA = artistRanks(db, a);
  const ranksB = artistRanks(db, b);
  const top = (ranks: Map<string, unknown>) => [...ranks.keys()].slice(0, TOP);
  const artists = [...new Set([...top(ranksB), ...top(ranksA)])].map((artist) => {
    const inA = ranksA.get(artist) ?? null;
    const inB = ranksB.get(artist) ?? null;
    return { artist, a: inA, b: inB, change: inA && inB ? inA.rank - inB.rank : null };
  });
  return {
    years: listeningYears(db),
    a: side(db, a),
    b: side(db, b),
    artists: withArtistImages(db, artists),
    genres: tagRows(db, "genres", a, b),
    moods: tagRows(db, "moods", a, b),
  };
}
