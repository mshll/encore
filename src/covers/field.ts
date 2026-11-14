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

/** A lit sphere upper right with a faint halo. */
export function orbField(): Field {
  const out = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const r = Math.hypot(x - GRID * 0.6, y - GRID * 0.36) / (GRID * 0.4);
      const lit = clamp(1 - Math.hypot(x - GRID * 0.72, y - GRID * 0.22) / (GRID * 0.62), 0, 1);
      out[y * GRID + x] = r < 1 ? 0.18 + 0.82 * lit ** 1.4 : clamp(0.34 - (r - 1) * 0.55, 0, 0.34);
    }
  }
  return out;
}

/** Two crossing sets of ripples from opposite corners, brighter at the top. */
export function wavesField(): Field {
  const out = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const a = Math.sin(Math.hypot(x - GRID * 0.1, y - GRID * 1.1) * 0.2);
      const b = Math.sin(Math.hypot(x - GRID * 1.05, y - GRID * 0.05) * 0.13);
      out[y * GRID + x] = clamp(0.5 + 0.34 * a + 0.3 * b, 0, 1) * (0.35 + 0.65 * (1 - y / GRID));
    }
  }
  return out;
}

/** A fan of beams from the top right corner, fading with distance. */
export function raysField(): Field {
  const out = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const dx = GRID * 1.02 - x;
      const dy = y + GRID * 0.02;
      const beam = 0.5 + 0.5 * Math.cos(Math.atan2(dy, dx) * 26);
      out[y * GRID + x] = clamp(1.25 - Math.hypot(dx, dy) / (GRID * 1.05), 0, 1) * (0.15 + 0.85 * beam ** 2);
    }
  }
  return out;
}

const TILE = GRID / 8;
const TILE_GAP = 3;
const TILE_LEVELS = [0.95, 0.35, 0.7, 0.15, 0.55, 0.85, 0.25, 0.6];

/** A calendar-like grid of square tiles with fixed levels, brighter towards the top right. */
export function tilesField(): Field {
  const out = new Float32Array(GRID * GRID);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const [col, row] = [Math.floor(x / TILE), Math.floor(y / TILE)];
      if (x % TILE >= TILE - TILE_GAP || y % TILE >= TILE - TILE_GAP) continue;
      const level = TILE_LEVELS[(col * 3 + row * 5) % TILE_LEVELS.length]!;
      out[y * GRID + x] = level * clamp(0.45 + col / 10 - row / 14, 0.15, 1);
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
