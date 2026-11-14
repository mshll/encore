import type { DigestFacts } from "./facts";

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** The digest written from the facts alone, used when Claude's text keeps stating numbers the facts don't have. */
export function renderFactsDigest(kind: "weekly" | "monthly", f: DigestFacts): string {
  const span = kind === "weekly" ? "this week" : "this month";
  const t = f.totals;
  const lines = [`${t.hours} hours of music ${span}, against ${t.baselineHours} in a typical ${kind === "weekly" ? "week" : "month"} before it.`];
  lines.push(`${t.listens} listens across ${t.uniqueArtists} artists and ${t.uniqueSongs} songs.`);
  if (f.topArtists.length) lines.push(`Most played: ${list(f.topArtists.slice(0, 3).map((a) => `${a.artist} (${a.hours} h)`))}.`);
  if (f.topSongs.length) lines.push(`Top songs: ${list(f.topSongs.slice(0, 3).map((s) => `${s.name} by ${s.artist} (${s.listens} listens)`))}.`);
  if (f.risingArtists.length) lines.push(`Up from before: ${list(f.risingArtists.map((a) => `${a.artist} (${a.hours} h, from ${a.baselineHours})`))}.`);
  if (f.fadingArtists.length) lines.push(`Down from before: ${list(f.fadingArtists.map((a) => `${a.artist} (${a.hours} h, from ${a.baselineHours})`))}.`);
  if (f.newArtists.count) lines.push(`${f.newArtists.count} artists you hadn't played before, led by ${list(f.newArtists.top.slice(0, 3).map((a) => (a as { artist: string }).artist))}.`);
  if (f.assistant.picksMade) lines.push(`${f.assistant.picksPlayed} of ${f.assistant.picksMade} weekly picks played.`);
  return lines.join("\n");
}
