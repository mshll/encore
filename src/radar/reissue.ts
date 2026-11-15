const VERSION_WORDS = /\b(remaster(ed)?|live|anniversary|deluxe|re-?recorded|re-?issue|expanded edition|box set)\b/i;
const ANYWHERE = /\bremaster(ed)?\b|\bre-?recorded\b|\b\d+(st|nd|rd|th) anniversary\b|^live (at|from|in)\b/i;

/** The version notes of a title: each bracketed part and the part after the last " - ". The name before them is left out, so "Live Forever" or "Anniversary" stay new music. */
function versionNotes(title: string): string[] {
  const notes = [...title.matchAll(/[([]([^)\]]*)[)\]]/g)].map((m) => m[1]!);
  const dash = title.lastIndexOf(" - ");
  if (dash > 0) notes.push(title.slice(dash + 3));
  return notes;
}

/** A remaster, live recording, anniversary or deluxe edition, re-recording or compilation: older music released again. */
export function isReissue(release: { name: string; albumType: string }): boolean {
  if (release.albumType === "compilation") return true;
  return ANYWHERE.test(release.name) || versionNotes(release.name).some((note) => VERSION_WORDS.test(note));
}
