/** Width in pixels of `text` set at `px`. */
export type Measure = (text: string, px: number) => number;
export type TitleLayout = { px: number; lines: string[] };
export type TitleFit = { maxWidth: number; maxPx: number; minPx: number; maxLines: number };

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*|️/gu;
const IGNORED = /[\s\p{Cf}]/u;

/** The title as drawn: NFC, emoji removed (no bundled font has them), whitespace collapsed. */
export function cleanTitle(title: string): string {
  return title.normalize("NFC").replace(EMOJI, " ").replace(/\s+/g, " ").trim();
}

/** Every visible character has a glyph in one of the bundled fonts. */
export function titleCovered(text: string, covered: (codePoint: number) => boolean): boolean {
  for (const ch of text) if (!IGNORED.test(ch) && !covered(ch.codePointAt(0)!)) return false;
  return text.length > 0;
}

/** Right to left when the first letter is Arabic or Hebrew. */
export function isRtl(text: string): boolean {
  const first = text.match(/\p{L}/u)?.[0];
  return first !== undefined && /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(first);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function wrap(words: string[], px: number, measure: Measure, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (!line || measure(trial, px) <= maxWidth) line = trial;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Splits a word wider than the line into pieces that fit. */
function breakWord(word: string, px: number, measure: Measure, maxWidth: number): string[] {
  if (measure(word, px) <= maxWidth) return [word];
  const pieces: string[] = [];
  let piece = "";
  for (const { segment } of graphemes.segment(word)) {
    if (piece && measure(piece + segment, px) > maxWidth) {
      pieces.push(piece);
      piece = segment;
    } else piece += segment;
  }
  return piece ? [...pieces, piece] : pieces;
}

/**
 * The largest size, stepping down 2 px from `maxPx`, at which the title wraps to `maxLines` or fewer lines that all fit.
 * Below `minPx` it stays at `minPx`, breaks words that are wider than a line, and takes as many lines as it needs, so it never clips.
 */
export function layoutTitle(title: string, measure: Measure, fit: TitleFit): TitleLayout {
  const words = title.split(" ").filter(Boolean);
  for (let px = fit.maxPx; px >= fit.minPx; px -= 2) {
    const lines = wrap(words, px, measure, fit.maxWidth);
    if (lines.length <= fit.maxLines && lines.every((l) => measure(l, px) <= fit.maxWidth)) return { px, lines };
  }
  const pieces = words.flatMap((w) => breakWord(w, fit.minPx, measure, fit.maxWidth));
  return { px: fit.minPx, lines: wrap(pieces, fit.minPx, measure, fit.maxWidth) };
}
