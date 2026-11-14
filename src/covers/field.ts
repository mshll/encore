export const COVER_SIZE = 640;
export const GRID = 160;
export const CELL = COVER_SIZE / GRID;

/** A GRID x GRID map of values from 0 to 1, row by row. */
export type Field = Float32Array;
export type Rgb = readonly [number, number, number];

export const INK: Rgb = [11, 11, 11];
export const PAPER: Rgb = [244, 240, 230];

const B4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** 8x8 ordered-dither thresholds, each in (0, 1). */
export const BAYER8: number[][] = Array.from({ length: 8 }, (_, y) =>
  Array.from({ length: 8 }, (_, x) => {
    const base = 4 * B4[y % 4]![x % 4]!;
    const offset = [
      [0, 2],
      [3, 1],
    ][y >> 2]![x >> 2]!;
    return (base + offset + 0.5) / 64;
  }),
);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Which colour stop each cell takes: the 0..1 field spread over `stops` colours with an ordered dither. */
export function ditherIndices(field: Field, stops: number): Uint8Array {
  const out = new Uint8Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const g = clamp(field[y * GRID + x]!, 0, 1);
      out[y * GRID + x] = clamp(Math.floor(g * (stops - 1) + BAYER8[y % 8]![x % 8]!), 0, stops - 1);
    }
  }
  return out;
}

/** Fades the field to 0 from `start` to `end` of the height, so the title always sits on ink. */
export function floorFade(field: Field, start = 0.42, end = 0.7): Field {
  const out = new Float32Array(field.length);
  for (let y = 0; y < GRID; y++) {
    const k = clamp((GRID * end - y) / (GRID * (end - start)), 0, 1);
    for (let x = 0; x < GRID; x++) out[y * GRID + x] = field[y * GRID + x]! * k;
  }
  return out;
}

/** Concentric rings centred upper right: the cover when the set's album art cannot be used. */
export function ringsField(): Field {
  const out = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const r = Math.hypot(x - GRID * 0.66, y - GRID * 0.34);
      const g = clamp(1.3 - r / (GRID * 0.6), 0, 1) * (0.2 + 0.8 * (0.5 + 0.5 * Math.cos(r * 0.42)));
      out[y * GRID + x] = r < GRID * 0.04 ? 0 : g;
    }
  }
  return out;
}

/** Rotates a GRID x GRID map a quarter turn counter-clockwise, `turns` times. */
export function rotateQuarter(src: Float32Array, turns: number): Float32Array {
  let cur = src;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const next = new Float32Array(cur.length);
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) next[y * GRID + x] = cur[x * GRID + (GRID - 1 - y)]!;
    cur = next;
  }
  return cur;
}

export function gaussianBlur(src: Float32Array, sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const weights = kernel.map((k) => k / sum);
  const pass = (input: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(input.length);
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? clamp(x + k, 0, GRID - 1) : x;
          const sy = horizontal ? y : clamp(y + k, 0, GRID - 1);
          acc += input[sy * GRID + sx]! * weights[k + radius]!;
        }
        out[y * GRID + x] = acc;
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/** Stretches values to 0..1, ignoring the darkest and lightest `cutoff` share of cells. */
export function autoContrast(src: Float32Array, cutoff = 0.01): Field {
  const sorted = Float32Array.from(src).sort();
  const skip = Math.floor(sorted.length * cutoff);
  const lo = sorted[skip]!;
  const hi = sorted[sorted.length - 1 - skip]!;
  if (hi - lo < 1e-6) return new Float32Array(src.length).fill(0.5);
  return src.map((v) => clamp((v - lo) / (hi - lo), 0, 1));
}

/** The set's covers as one soft light map: each luminance map turned a quarter more than the last, averaged, blurred, stretched. */
export function coverField(lumas: Float32Array[]): Field {
  const sum = new Float32Array(GRID * GRID);
  lumas.forEach((luma, i) => rotateQuarter(luma, i).forEach((v, j) => (sum[j] = sum[j]! + v)));
  return autoContrast(gaussianBlur(sum, 16));
}
