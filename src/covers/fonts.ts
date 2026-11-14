import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";

const FONT_DIR = join(import.meta.dir, "../../assets/fonts");

/** Bundled faces, in fallback order. Skia falls back to system fonts for anything else, which differ by host, so titles are checked against these alone. */
const FACES = [
  { family: "Encore Cover Title", file: "BricolageGrotesque-SemiBold.ttf" },
  { family: "Encore Cover Arabic", file: "NotoSansArabic-SemiBold.ttf" },
];

export const TITLE_FONT_STACK = FACES.map((f) => `"${f.family}"`).join(", ");

/** Code points with a glyph in a TrueType font's Unicode cmap (formats 4 and 12). */
export function cmapCodePoints(bytes: Uint8Array): Set<number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = view.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(rec, rec + 4)) === "cmap") cmap = view.getUint32(rec + 8);
  }
  if (cmap < 0) throw new Error("Font has no cmap table");
  const subtables = Array.from({ length: view.getUint16(cmap + 2) }, (_, i) => {
    const rec = cmap + 4 + i * 8;
    const offset = cmap + view.getUint32(rec + 4);
    return { platform: view.getUint16(rec), encoding: view.getUint16(rec + 2), offset, format: view.getUint16(offset) };
  });
  const full = subtables.find((s) => s.format === 12 && (s.platform === 3 || s.platform === 0));
  const bmp = subtables.find((s) => s.format === 4 && (s.platform === 3 || s.platform === 0));
  const out = new Set<number>();
  if (full) {
    const groups = view.getUint32(full.offset + 12);
    for (let g = 0; g < groups; g++) {
      const at = full.offset + 16 + g * 12;
      for (let cp = view.getUint32(at); cp <= view.getUint32(at + 4); cp++) out.add(cp);
    }
    return out;
  }
  if (!bmp) throw new Error("Font has no Unicode cmap");
  const segs = view.getUint16(bmp.offset + 6) / 2;
  const ends = bmp.offset + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const ranges = deltas + segs * 2;
  for (let i = 0; i < segs; i++) {
    const start = view.getUint16(starts + i * 2);
    const end = view.getUint16(ends + i * 2);
    const delta = view.getInt16(deltas + i * 2);
    const rangeOffset = view.getUint16(ranges + i * 2);
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      const glyph = rangeOffset === 0 ? (cp + delta) & 0xffff : view.getUint16(ranges + i * 2 + rangeOffset + (cp - start) * 2);
      if (glyph !== 0) out.add(cp);
    }
  }
  return out;
}

let coverage: Set<number> | null = null;

/** Registers the bundled faces with Skia once and returns the code points they cover together. */
export function coverFonts(): Set<number> {
  if (coverage) return coverage;
  const all = new Set<number>();
  for (const face of FACES) {
    const path = join(FONT_DIR, face.file);
    if (!GlobalFonts.registerFromPath(path, face.family)) throw new Error(`Could not load the cover font ${face.file}`);
    for (const cp of cmapCodePoints(readFileSync(path))) all.add(cp);
  }
  coverage = all;
  return all;
}
