import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fetchArt, isArtUrl } from "../src/covers/art";
import { GRID, INK, PAPER, ditherIndices, floorFade, ringsField } from "../src/covers/field";
import { cmapCodePoints } from "../src/covers/fonts";
import { MARK_PATH } from "../src/covers/mark";
import { base64Length, coverTitleClamped, encodeToFit, makeCover, UPLOAD_LIMIT } from "../src/covers/render";
import { colourStops, dominantHue, rgbToHls, tone } from "../src/covers/tint";
import { clampTitle, cleanTitle, isRtl, layoutTitle, titleCovered, type Measure } from "../src/covers/title";

const fonts = join(import.meta.dir, "../assets/fonts");
const flat = (v: number) => new Float32Array(GRID * GRID).fill(v);

describe("dither", () => {
  test("0 is all ink and 1 is all paper", () => {
    const dark = ditherIndices(flat(0), 4);
    const light = ditherIndices(flat(1), 4);

    expect([new Set(dark), new Set(light)]).toEqual([new Set([0]), new Set([3])]);
  });

  test("a value between two stops mixes those two stops in proportion", () => {
    const indices = ditherIndices(flat(0.5), 4);

    const counts = [0, 1, 2, 3].map((s) => indices.filter((i) => i === s).length / indices.length);
    expect(counts).toEqual([0, 0.5, 0.5, 0]);
  });

  test("the floor fade leaves the top alone and the bottom 30% at zero", () => {
    const faded = floorFade(flat(1));

    expect(faded[Math.floor(GRID * 0.4) * GRID]).toBe(1);
    expect(faded.slice(Math.ceil(GRID * 0.7) * GRID).every((v) => v === 0)).toBe(true);
  });

  test("rings have a dark centre upper right", () => {
    const rings = ringsField();

    expect(rings[Math.round(GRID * 0.34) * GRID + Math.round(GRID * 0.66)]).toBe(0);
  });
});

describe("tint", () => {
  const px = (rgb: readonly [number, number, number], n: number) => Array.from({ length: n }, () => rgb);

  test("the most present saturated colour wins over a larger grey area", () => {
    const hue = dominantHue([...px([128, 128, 128], 700), ...px([200, 30, 30], 300)]);

    expect(hue!.h).toBeCloseTo(0, 2);
  });

  test("a grey cover has no hue", () => {
    expect(dominantHue([...px([20, 20, 20], 500), ...px([220, 220, 220], 500)])).toBeNull();
  });

  test("a tone has the fixed lightness and at least half saturation", () => {
    const [, l, s] = rgbToHls(tone({ h: 0.6, s: 0.2 }, 0.62));

    expect(l).toBeCloseTo(0.62, 1);
    expect(s).toBeCloseTo(0.5, 1);
  });

  test("stops run ink, dark from the second cover, mid from the lead cover, paper", () => {
    const stops = colourStops({ h: 0, s: 1 }, { h: 2 / 3, s: 1 });

    expect([stops[0], stops[3]]).toEqual([INK, PAPER]);
    expect(rgbToHls(stops[1]!)[0]).toBeCloseTo(2 / 3, 2);
    expect(rgbToHls(stops[2]!)[0]).toBeCloseTo(0, 2);
  });
});

describe("title", () => {
  const measure: Measure = (text, px) => [...text].length * px * 0.5;
  const fit = { maxWidth: 560, maxPx: 78, minPx: 32, maxLines: 3 };

  test("a short title stays at full size on one line", () => {
    expect(layoutTitle("Late drive", measure, fit)).toEqual({ px: 78, lines: ["Late drive"] });
  });

  test("a title that needs more than 3 lines at full size shrinks until it fits 3", () => {
    const layout = layoutTitle("Late night drives through the city when it is slow", measure, fit);

    expect(layout.px).toBeLessThan(78);
    expect(layout.lines.length).toBeLessThanOrEqual(3);
    expect(layout.lines.every((l) => measure(l, layout.px) <= 560)).toBe(true);
  });

  test("a word wider than the line breaks at the smallest size instead of clipping", () => {
    const word = "x".repeat(80);

    const layout = layoutTitle(word, measure, fit);

    expect(layout.px).toBe(32);
    expect(layout.lines.join("")).toBe(word);
    expect(layout.lines.every((l) => measure(l, 32) <= 560)).toBe(true);
  });

  test("a clamped title that fits at its smallest size or larger is laid out as before", () => {
    const title = "Late night drives through the city when it is slow";

    expect(clampTitle(title, measure, fit)).toEqual({ ...layoutTitle(title, measure, fit), clamped: false });
  });

  test("a clamped title too long for its lines keeps its first lines at the smallest size and ends in an ellipsis", () => {
    const title = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");

    const layout = clampTitle(title, measure, fit);

    expect([layout.px, layout.lines.length, layout.lines.at(-1)!.endsWith("…"), layout.clamped]).toEqual([32, 3, true, true]);
    expect(layout.lines.every((l) => measure(l, 32) <= 560)).toBe(true);
  });

  test("emoji are dropped and whitespace collapsed", () => {
    expect(cleanTitle("Late  drive 🚗🌙 ")).toBe("Late drive");
  });

  test("a script no bundled font covers is reported, so it is never drawn as boxes", () => {
    const covered = (cp: number) => cp < 0x0300 || (cp >= 0x0600 && cp <= 0x06ff);

    expect([titleCovered("Late drive", covered), titleCovered("ليل الكويت", covered), titleCovered("東京 night", covered)]).toEqual([true, true, false]);
  });

  test("direction follows the first letter", () => {
    expect([isRtl("ليل Kuwait"), isRtl("2026 ليل"), isRtl("Kuwait ليل")]).toEqual([true, true, false]);
  });
});

describe("bundled fonts", () => {
  test("Bricolage covers Latin and the Arabic fallback covers Arabic", () => {
    const latin = cmapCodePoints(readFileSync(join(fonts, "BricolageGrotesque-SemiBold.ttf")));
    const arabic = cmapCodePoints(readFileSync(join(fonts, "NotoSansArabic-SemiBold.ttf")));

    expect([latin.has(0x41), latin.has(0x0639), arabic.has(0x0639), arabic.has(0x6771)]).toEqual([true, false, true, false]);
  });

  test("the cover mark is the logo", () => {
    expect(readFileSync(join(import.meta.dir, "../web/public/logo.svg"), "utf8")).toContain(`d="${MARK_PATH}"`);
  });
});

describe("JPEG size", () => {
  test("takes the highest quality whose base64 fits the upload limit", async () => {
    const encode = async (q: number) => new Uint8Array(q * 2000);

    const { quality, jpeg } = await encodeToFit(encode, 200_000);

    expect(quality).toBe(72);
    expect(base64Length(jpeg.byteLength)).toBeLessThanOrEqual(200_000);
  });

  test("fails when even the lowest quality is too large", async () => {
    expect(encodeToFit(async () => new Uint8Array(1_000_000))).rejects.toThrow("does not fit");
  });
});

describe("album art fetch", () => {
  const image = new Uint8Array(1000).fill(7);

  test("only Spotify's image CDN over https", () => {
    expect(["https://i.scdn.co/image/x", "https://image-cdn-ak.spotifycdn.com/image/x", "http://i.scdn.co/image/x", "https://img.test/x.jpg", "https://scdn.co.evil.test/x"].map(isArtUrl)).toEqual([true, true, false, false, false]);
  });

  test("a refused host is never requested", async () => {
    let calls = 0;
    const fetchFn = (async (_url: string | URL | Request) => (calls++, new Response(image))) as typeof fetch;

    expect(await fetchArt("https://img.test/x.jpg", fetchFn)).toBeNull();
    expect(calls).toBe(0);
  });

  test("returns the bytes, or null when larger than the cap or when the request fails", async () => {
    const ok = (async (_url: string | URL | Request) => new Response(image)) as typeof fetch;
    const failing = (async (_url: string | URL | Request): Promise<Response> => {
      throw new Error("timed out");
    }) as typeof fetch;

    expect(await fetchArt("https://i.scdn.co/image/x", ok)).toEqual(image);
    expect(await fetchArt("https://i.scdn.co/image/x", ok, 500)).toBeNull();
    expect(await fetchArt("https://i.scdn.co/image/x", failing)).toBeNull();
  });
});

async function png(rgb: string) {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = rgb;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 32, 32);
  return new Uint8Array(await canvas.encode("png"));
}

describe("rendering", () => {
  test("rings need no network and give a 640 x 640 JPEG under the upload limit", async () => {
    const cover = await makeCover({ title: "Late drive", covers: [], style: "rings", fetchFn: ((_url: string | URL | Request) => Promise.reject(new Error("no network"))) as typeof fetch });

    const image = await loadImage(Buffer.from(cover.jpeg));
    expect([image.width, image.height, cover.style, cover.titleDrawn]).toEqual([640, 640, "rings", true]);
    expect(base64Length(cover.jpeg.byteLength)).toBeLessThanOrEqual(UPLOAD_LIMIT);
  });

  test("field draws from 2 or more covers and falls back to rings with fewer", async () => {
    const red = await png("#c02020");
    const blue = await png("#2040c0");

    const both = await makeCover({ title: "x", covers: [red, blue], style: "field" });
    const one = await makeCover({ title: "x", covers: [red, new Uint8Array([1, 2, 3])], style: "field" });

    expect([both.style, both.partial, one.style, one.partial]).toEqual(["field", false, "rings", true]);
  });

  test("the abstract styles draw without album art and keep their style", async () => {
    const styles = ["orb", "waves", "rays", "tiles"] as const;

    const drawn = await Promise.all(styles.map((style) => makeCover({ title: "x", covers: [], style })));

    expect(drawn.map((c) => c.style)).toEqual([...styles]);
  });

  test("fixed colours replace the colours of the covers", async () => {
    const red = await png("#c02020");
    const blue = await png("#2040c0");

    const cover = await makeCover({ title: "x", covers: [red, blue], style: "orb", colours: { lead: { h: 0.33, s: 0.7 }, second: { h: 0.33, s: 0.7 } } });

    const image = await loadImage(Buffer.from(cover.jpeg));
    const canvas = createCanvas(64, 64);
    canvas.getContext("2d").drawImage(image, 0, 0, 64, 64);
    const px = canvas.getContext("2d").getImageData(0, 0, 64, 32).data;
    const pixels = Array.from({ length: px.length / 4 }, (_, i) => [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!] as const);
    expect(dominantHue(pixels)!.h).toBeCloseTo(0.33, 1);
  });

  test("only a title too long for the cover is clamped", () => {
    const long = "Songs I kept coming back to on the long drives home from the coast every summer";

    expect([coverTitleClamped("Late drive"), coverTitleClamped("Forgotten favourites"), coverTitleClamped(long)]).toEqual([false, false, true]);
  });

  test("a title in a script without a bundled font is left off", async () => {
    const cover = await makeCover({ title: "東京の夜", covers: [], style: "rings" });

    expect(cover.titleDrawn).toBe(false);
  });
});
