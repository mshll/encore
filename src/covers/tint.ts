import { INK, PAPER, type Rgb } from "./field";

/** A colour's hue and saturation, 0 to 1 (HLS). */
export type Hue = { h: number; s: number };

/** Used for the dark and mid tones when no cover could be loaded: near the encore green. */
export const DEFAULT_HUE: Hue = { h: 0.38, s: 0.75 };

const SATURATION_FLOOR = 0.5;
const GREY_BELOW = 0.1;

export function rgbToHls([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, l, 0];
  const d = max - min;
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  const h = max === rr ? (gg - bb) / d : max === gg ? 2 + (bb - rr) / d : 4 + (rr - gg) / d;
  return [(((h / 6) % 1) + 1) % 1, l, s];
}

export function hlsToRgb(h: number, l: number, s: number): Rgb {
  if (s === 0) return [Math.round(l * 255), Math.round(l * 255), Math.round(l * 255)];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  const channel = (hue: number) => {
    const t = ((hue % 1) + 1) % 1;
    if (t < 1 / 6) return m1 + (m2 - m1) * t * 6;
    if (t < 0.5) return m2;
    if (t < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - t) * 6;
    return m1;
  };
  return [Math.round(channel(h + 1 / 3) * 255), Math.round(channel(h) * 255), Math.round(channel(h - 1 / 3) * 255)];
}

type Box = { pixels: Rgb[] };

const span = (pixels: Rgb[], c: number) => {
  let lo = 255;
  let hi = 0;
  for (const p of pixels) {
    lo = Math.min(lo, p[c]!);
    hi = Math.max(hi, p[c]!);
  }
  return hi - lo;
};

/** Median cut: the image reduced to at most `count` colours, each with how many pixels it stands for. */
export function palette(pixels: Rgb[], count = 8): { rgb: Rgb; count: number }[] {
  const boxes: Box[] = [{ pixels }];
  while (boxes.length < count) {
    let best = -1;
    let bestSpan = 0;
    boxes.forEach((box, i) => {
      const widest = Math.max(span(box.pixels, 0), span(box.pixels, 1), span(box.pixels, 2));
      if (box.pixels.length > 1 && widest > bestSpan) [best, bestSpan] = [i, widest];
    });
    if (best < 0) break;
    const box = boxes[best]!;
    const channel = [0, 1, 2].reduce((a, c) => (span(box.pixels, c) > span(box.pixels, a) ? c : a), 0);
    const sorted = [...box.pixels].sort((a, b) => a[channel]! - b[channel]!);
    const mid = sorted.length >> 1;
    boxes.splice(best, 1, { pixels: sorted.slice(0, mid) }, { pixels: sorted.slice(mid) });
  }
  return boxes
    .filter((b) => b.pixels.length > 0)
    .map((b) => {
      const [r, g, bl] = b.pixels.reduce<[number, number, number]>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
      const n = b.pixels.length;
      const rgb: Rgb = [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
      return { rgb, count: n };
    });
}

/** The most present saturated colour of a cover, or null for a grey one. */
export function dominantHue(pixels: Rgb[]): Hue | null {
  let best: Hue | null = null;
  let bestScore = -1;
  for (const { rgb, count } of palette(pixels)) {
    const [h, l, s] = rgbToHls(rgb);
    const score = count * s * (1 - Math.abs(l - 0.5));
    if (score > bestScore) [best, bestScore] = [{ h, s }, score];
  }
  return best && best.s >= GREY_BELOW ? best : null;
}

/** A tone of the hue at a fixed lightness; a grey cover gives a neutral grey. */
export function tone(hue: Hue | null, lightness: number): Rgb {
  return hue ? hlsToRgb(hue.h, lightness, Math.max(hue.s, SATURATION_FLOOR)) : hlsToRgb(0, lightness, 0);
}

/** Ink, a dark tone from the second cover, a mid tone from the lead cover, paper. */
export function colourStops(lead: Hue | null, second: Hue | null): Rgb[] {
  return [INK, tone(second ?? lead, 0.4), tone(lead ?? second, 0.62), PAPER];
}
