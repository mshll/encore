import { sql } from "drizzle-orm";
import { MS, MUSIC, musicWhere } from "../analytics/common";
import { devices, overview } from "../analytics/overview";
import { skips } from "../analytics/skips";
import { topArtists, topTracks } from "../analytics/top";
import type { Db } from "../db/client";
import { loadCatalog, type HourBucket } from "../library/catalog";
import { listBlocks } from "../library/blocks";
import { localTime } from "../plays/localTime";
import { pickOutcomeSummary } from "../picks/outcomes";
import { setOutcomeSummary } from "../sets/outcomes";

const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${Math.round(n * 100)}%`);
const h = (hours: number) => `${Math.round(hours)}h`;

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function tagShares(db: Db, column: "genres" | "moods", from: string | undefined) {
  const rows = db.all<{ value: string; ms: number }>(sql`
    select j.value as value, sum(${MS}) as ms
    from ${MUSIC} join track_tags tg on tg.song_key = t.song_key, json_each(tg.${sql.raw(column)}) j
    where ${musicWhere({ from })} group by j.value order by ms desc`);
  const tagged = db.all<{ ms: number }>(sql`
    select sum(${MS}) as ms from ${MUSIC} join track_tags tg on tg.song_key = t.song_key where ${musicWhere({ from })}`)[0]?.ms ?? 0;
  return rows.slice(0, 10).map((r) => `${r.value} ${pct(tagged ? r.ms / tagged : 0)}`).join(", ");
}

function moodByBucket(db: Db, from: string) {
  const rows = db.all<{ bucket: HourBucket; energy: number; valence: number; listens: number }>(sql`
    select case when p.hour < 6 then 'night' when p.hour < 12 then 'morning' when p.hour < 18 then 'afternoon' else 'evening' end as bucket,
      avg(tg.energy) as energy, avg(tg.valence) as valence, count(*) as listens
    from ${MUSIC} join track_tags tg on tg.song_key = t.song_key
    where ${musicWhere({ from })} and (p.source = 'api' or p.ms_played >= 30000) group by bucket`);
  const order: HourBucket[] = ["morning", "afternoon", "evening", "night"];
  return order
    .map((b) => rows.find((r) => r.bucket === b))
    .filter((r) => r !== undefined)
    .map((r) => `${r.bucket} energy ${r.energy.toFixed(1)} valence ${r.valence.toFixed(1)} (${r.listens} listens)`)
    .join("; ");
}

function languages(db: Db) {
  const rows = db.all<{ language: string; ms: number }>(sql`
    select tg.language, sum(${MS}) as ms from ${MUSIC} join track_tags tg on tg.song_key = t.song_key
    where ${musicWhere({})} group by tg.language order by ms desc limit 6`);
  const total = rows.reduce((s, r) => s + r.ms, 0);
  return rows.map((r) => `${r.language} ${pct(total ? r.ms / total : 0)}`).join(", ");
}

/** Deterministic, compact summary of the owner's taste. Stable for a given data state and day so it caches as a prompt prefix. */
export function buildTasteProfile(db: Db, timezone: string, now: number): string {
  const today = localTime(now, timezone).day;
  const all = overview(db, { range: {} });
  if (all.plays === 0) return "# Taste profile\n\nNo listening history yet.";
  const lines: string[] = [`# Taste profile (as of ${today}, local time ${timezone})`, ""];
  const deviceShares = devices(db, { range: {}, period: "year" })
    .totals.slice(0, 3)
    .map((d) => `${d.device} ${pct(d.share)}`)
    .join(", ");
  lines.push(
    "## Summary",
    `History ${all.firstPlayed?.slice(0, 10)} to ${all.lastPlayed?.slice(0, 10)}: ${h(all.hours)}, ${all.plays} plays, ${all.uniqueTracks} songs, ${all.uniqueArtists} artists.`,
    `Skip rate ${pct(all.skipRate)}, shuffle ${pct(all.shuffleRate)}. Devices by hours: ${deviceShares}.`,
    "A skip is not a dislike here: most skips happen on shuffle and depend on the moment. Use the moment classes below.",
    "",
    "## Eras: top artists by hours per year",
  );
  const firstYear = Number(all.firstPlayed!.slice(0, 4));
  const lastYear = Number(today.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year++) {
    const top = topArtists(db, { range: { from: `${year}-01-01`, to: `${year}-12-31` }, limit: 6 });
    if (top.length) lines.push(`${year}: ${top.map((a) => `${a.artist} ${h(a.hours)}`).join(", ")}`);
  }
  const songLine = (s: { name: string; artist: string; listens: number }) => `${s.name} - ${s.artist} (${s.listens})`;
  lines.push(
    "",
    "## Top artists, all time (hours)",
    topArtists(db, { range: {}, limit: 20 })
      .map((a) => `${a.artist} ${h(a.hours)}`)
      .join(", "),
    "",
    "## Top artists, last 90 days (hours)",
    topArtists(db, { range: { from: shiftDay(today, -90) }, limit: 12 })
      .map((a) => `${a.artist} ${Math.round(a.hours * 10) / 10}h`)
      .join(", "),
    "",
    "## Top songs, all time (listens)",
    topTracks(db, { range: {}, limit: 20, sort: "listens" }).map(songLine).join("; "),
    "",
    "## Current rotation, last 30 days (listens)",
    topTracks(db, { range: { from: shiftDay(today, -30) }, limit: 15, sort: "listens" }).map(songLine).join("; "),
    "",
  );

  const catalog = loadCatalog(db);
  const songs = [...catalog.songs.values()];
  const tagged = songs.filter((s) => s.tags).length;
  lines.push(
    `## Tags (LLM-generated, ${tagged} of ${songs.length} songs tagged; energy and valence are 1-5)`,
    `Genres all time: ${tagShares(db, "genres", undefined)}`,
    `Genres last 12 months: ${tagShares(db, "genres", shiftDay(today, -365))}`,
    `Moods last 12 months: ${tagShares(db, "moods", shiftDay(today, -365))}`,
    `Languages: ${languages(db)}`,
    `Energy and valence by time of day, last 12 months: ${moodByBucket(db, shiftDay(today, -365))}`,
    "",
  );

  const classified = songs.filter((s) => s.class);
  const count = (c: string) => classified.filter((s) => s.class === c).length;
  const byPlays = (a: { plays: number }, b: { plays: number }) => b.plays - a.plays;
  const contextNote = (s: (typeof songs)[number]) => {
    const rates = [...Object.entries(s.hourBucket), ...Object.entries(s.dayType)]
      .filter(([, c]) => c && c.plays >= 5)
      .map(([k, c]) => ({ k, rate: c!.skips / c!.plays }))
      .sort((a, b) => a.rate - b.rate);
    const best = rates[0];
    const worst = rates[rates.length - 1];
    return best && worst && best !== worst ? `works ${best.k} (skip ${pct(best.rate)}), fails ${worst.k} (skip ${pct(worst.rate)})` : "";
  };
  lines.push(
    "## Moment classes (songs with 8+ plays with skip data)",
    `keeper ${count("keeper")}, wrong_moment ${count("wrong_moment")}, dislike ${count("dislike")}, mixed ${count("mixed")}.`,
    `Keepers (rarely skipped): ${classified
      .filter((s) => s.class === "keeper")
      .sort(byPlays)
      .slice(0, 15)
      .map((s) => `${s.name} - ${s.artist}`)
      .join("; ")}`,
    `Wrong-moment songs (loved in one context, skipped in another): ${classified
      .filter((s) => s.class === "wrong_moment")
      .sort(byPlays)
      .slice(0, 12)
      .map((s) => `${s.name} - ${s.artist}: ${contextNote(s)}`)
      .join("; ")}`,
    `Hard dislikes (skipped nearly everywhere): ${classified
      .filter((s) => s.class === "dislike")
      .sort(byPlays)
      .slice(0, 15)
      .map((s) => `${s.name} - ${s.artist}`)
      .join("; ")}`,
    `Most skipped artists (20+ plays): ${skips(db, { range: {}, minPlays: 20, limit: 10 })
      .mostSkippedArtists.map((a) => `${a.artist} ${pct(a.skipRate)}`)
      .join(", ")}`,
    "",
  );

  const blocks = listBlocks(db);
  lines.push(
    "## Blocked by the owner (never suggest)",
    blocks.length ? blocks.map((b) => `${b.kind}: ${b.label}`).join("; ") : "none",
    "",
    "## How past suggestions landed",
    setOutcomeSummary(db),
    pickOutcomeSummary(db),
  );
  return lines.join("\n");
}

let cached: { db: Db; key: string; text: string } | null = null;

export function tasteProfile(db: Db, timezone: string, now: number): string {
  const blocks = db.all<{ n: number; o: number }>(
    sql`select (select count(*) from blocks) as n, (select coalesce(max(state_at), 0) from picks) + (select coalesce(sum(plays_after), 0) from set_items) as o`,
  )[0]!;
  const key = `${localTime(now, timezone).day}:${loadCatalog(db).version}:${blocks.n}:${blocks.o}`;
  if (cached?.db !== db || cached.key !== key) cached = { db, key, text: buildTasteProfile(db, timezone, now) };
  return cached.text;
}
