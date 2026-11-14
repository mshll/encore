const featuring = /\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi;
const trailingFeaturing = /\s+(?:feat\.?|ft\.?|featuring)\s.*$/i;
const remasterSuffix = /\s+-\s+[^-]*\bremaster(?:ed)?\b.*$/i;
const remasterParen = /\s*[([][^)\]]*\bremaster(?:ed)?\b[^)\]]*[)\]]/gi;

function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeTitle(title: string): string {
  return fold(title.replace(featuring, "").replace(remasterParen, "").replace(remasterSuffix, "").replace(trailingFeaturing, ""));
}

export function songKey(title: string, artist: string): string {
  return `${normalizeTitle(title)}|${fold(artist)}`;
}
