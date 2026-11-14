/** Strips the markdown a model sometimes adds anyway, so text reads the same in a panel and in a chat message. */
export function plainText(text: string): string {
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.replace(/^\s{0,3}#{1,6}\s+/, "");
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) continue;
    if (/^\s*\|.*\|\s*$/.test(line))
      line = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
        .join(", ");
    line = line
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
      .replace(/`([^`\n]+)`/g, "$1");
    lines.push(line);
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when text meant for the owner carries a song reference (#123), a snake_case id (wrong_moment) or a field name. */
export function leaksInternals(text: string): boolean {
  return /#\d/.test(text) || /\b[a-z]+_[a-z_]+\b/.test(text) || /\b(songKey|playClass|finishedShare|lastPlayedGroup|uri)\b/.test(text);
}
