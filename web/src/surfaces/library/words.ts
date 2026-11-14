import type { Batch, LibraryAnalysis, LibraryPlace, PlanAction, PlanSummary, PlayClass, SongGroup } from "../../api/types";
import { fmtInt, fmtMonthLong } from "../../lib/format";

export const PLAY_CLASSES: PlayClass[] = ["active", "fading", "dormant", "never"];

type Rules = LibraryAnalysis["rules"];

const months = (days: number) => Math.round(days / 30);

/** When a song was last played, in the words of its class. "Never" counts from the start of the history. */
export function classLabel(c: PlayClass, rules: Rules): string {
  const fading = months(rules.fadingAfterDays);
  const dormant = months(rules.dormantAfterDays);
  if (c === "active") return `Played in the last ${fading} months`;
  if (c === "fading") return `Last played ${fading} to ${dormant} months ago`;
  if (c === "dormant") return `Not played in ${dormant} months or more`;
  return "Never played";
}

export const songs = (n: number) => `${fmtInt(n)} ${n === 1 ? "song" : "songs"}`;
export const changes = (n: number) => `${fmtInt(n)} ${n === 1 ? "change" : "changes"}`;

export const placeName = (where: LibraryPlace) => (where.kind === "liked" ? "liked songs" : where.name);

/** The heading of a group of plan items: what happens, and where. */
export function groupTitle(action: PlanAction, where: LibraryPlace): string {
  const place = where.kind === "liked" ? "your liked songs" : where.name;
  if (action === "archive") return `Archive from ${place}`;
  if (action === "remove") return `Remove from ${place}`;
  if (action === "save") return "Add to your liked songs";
  if (action === "add") return `Add to ${place}`;
  return `Remove extra copies in ${place}`;
}

export const SOURCE_LABEL: Record<PlanSummary["source"], string> = {
  rule: "Ready-made",
  analysis: "From the library overview",
  claude: "From Claude",
  standing: "From a standing instruction",
};

/** The page title for the songs behind a figure. `playlist` names the playlist when `where` is one. */
export function songGroupTitle(group: SongGroup, rules: Rules | undefined, playlist: string | undefined): string {
  if (group.kind === "unsaved") return "Played a lot, not liked";
  const place = group.where === "liked" ? "Liked songs" : (playlist ?? "Playlist");
  if (group.kind === "duplicates") return `Extra copies in ${playlist ?? "this playlist"}`;
  const parts = [place];
  if (group.artist) parts.push(`by ${group.artist}`);
  if (group.savedMonth) parts.push(`liked in ${fmtMonthLong(group.savedMonth)}`);
  const cls = group.classes ?? [];
  if (rules && cls.length === 1) return `${parts.join(" ")}: ${classLabel(cls[0]!, rules).toLowerCase()}`;
  if (rules && cls.length > 1 && cls.every((c) => c === "dormant" || c === "never")) return `${parts.join(" ")} you no longer play`;
  return parts.join(" ");
}

/** A link to the songs behind a figure. */
export function songsPath(group: SongGroup): string {
  const q = new URLSearchParams({ kind: group.kind });
  if (group.kind !== "unsaved") q.set("where", group.where);
  if (group.kind === "songs") {
    if (group.classes?.length) q.set("classes", group.classes.join(","));
    if (group.artist) q.set("artist", group.artist);
    if (group.savedMonth) q.set("savedMonth", group.savedMonth);
  }
  return `/library/songs?${q.toString()}`;
}

export function groupFromSearch(search: string): SongGroup {
  const q = new URLSearchParams(search);
  const kind = q.get("kind");
  const where = q.get("where") ?? "liked";
  if (kind === "unsaved") return { kind: "unsaved" };
  if (kind === "duplicates") return { kind: "duplicates", where };
  const classes = (q.get("classes") ?? "")
    .split(",")
    .filter((c): c is PlayClass => (PLAY_CLASSES as string[]).includes(c));
  return {
    kind: "songs",
    where,
    ...(classes.length ? { classes } : {}),
    ...(q.get("artist") ? { artist: q.get("artist")! } : {}),
    ...(q.get("savedMonth") ? { savedMonth: q.get("savedMonth")! } : {}),
  };
}

const ACTION_DONE: Record<PlanAction, [string, string]> = {
  archive: ["Archived", "archived"],
  remove: ["Removed", "removed"],
  save: ["Liked", "liked"],
  add: ["Added", "added"],
  dedupe: ["Removed extra copies of", "removed extra copies of"],
};

/** "Archived 118 songs, removed 2" from a batch's action counts. */
export function doneLine(actions: Batch["actions"]): string {
  const parts = (Object.keys(actions) as PlanAction[])
    .filter((a) => actions[a] > 0)
    .map((a, i) => `${ACTION_DONE[a][i === 0 ? 0 : 1]} ${i === 0 ? songs(actions[a]) : fmtInt(actions[a])}`);
  return parts.length ? parts.join(", ") : "Nothing changed";
}

/** What applying these counts does, one sentence per action. Liked songs taken out get the date-added consequence. */
export function consequences(selected: { action: PlanAction; where: LibraryPlace; n: number }[]): string[] {
  const by = (a: PlanAction) => selected.filter((s) => s.action === a).reduce((sum, s) => sum + s.n, 0);
  const lines = [
    by("archive") > 0 && `${songs(by("archive"))} move to your private playlist “encore archive” and out of where they are now.`,
    by("remove") > 0 && `${songs(by("remove"))} are removed from where they are now.`,
    by("save") > 0 && `${songs(by("save"))} are added to your liked songs.`,
    by("add") > 0 && `${songs(by("add"))} are added to the end of their playlists.`,
    by("dedupe") > 0 && `Extra copies of ${songs(by("dedupe"))} are removed. The first copy stays where it is.`,
    selected.some((s) => (s.action === "archive" || s.action === "remove") && s.where.kind === "liked" && s.n > 0) &&
      "A liked song you restore later gets a new date added in Spotify.",
  ];
  return lines.filter((l): l is string => Boolean(l));
}
