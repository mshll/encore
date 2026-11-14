import { sql } from "drizzle-orm";
import { z } from "zod";
import { withArtistImages } from "../analytics/common";
import type { Db } from "../db/client";
import { tool, ToolError, type AgentTool } from "../llm/agent";

/** How a value is printed: hours, a share of 0 to 1, or a count of `noun` ("plays"). */
export type Unit = { type: "hours" } | { type: "percent" } | { type: "count"; noun: string };

export type Item =
  | { kind: "song"; name: string; artist: string; songKey: string; uri: string | null; art: string | null }
  | { kind: "artist"; name: string; art: string | null }
  | { kind: "album"; name: string; artist: string; art: string | null }
  | { kind: "label"; name: string };

export type Axis = "year" | "month" | "week" | "day" | "hour" | "weekday" | "text";

/** A chart in an answer, with every value copied from a tool result of the run that made it. */
export type Visual =
  | { kind: "pair"; label: string; unit: Unit; now: number; before: number }
  | { kind: "share"; label: string; share: number; before: number | null }
  | { kind: "series"; title: string; unit: Unit; axis: Axis; points: { x: string; y: number }[] }
  | { kind: "ranked"; title: string; unit: Unit; rows: { item: Item; value: number }[] }
  | { kind: "compare"; title: string; unit: Unit; nowLabel: string; beforeLabel: string; rows: { label: string; now: number; before: number }[] };

/** Visuals that stand on their own line; the others sit in a sentence. A series can do both. */
export const BLOCK_KINDS: ReadonlySet<Visual["kind"]> = new Set(["ranked", "compare"]);

/** Every result a tool returned in one run, by the ref Claude cites. */
export class ResultRefs {
  private readonly results = new Map<string, unknown>();
  constructor(private next: number) {}

  add(value: unknown): string {
    const ref = `r${this.next++}`;
    this.results.set(ref, value);
    return ref;
  }

  get(ref: string): unknown {
    if (!this.results.has(ref)) throw new ToolError(`${ref} is not a result from this answer; cite a ref returned by a tool in this turn`);
    return this.results.get(ref);
  }

  values(): unknown[] {
    return [...this.results.values()];
  }
}

/** Wraps each tool so its result carries a ref (`{ ref, result }`) that visuals cite. */
export function withRefs(tools: AgentTool[], refs: ResultRefs): AgentTool[] {
  return tools.map((t) => ({
    ...t,
    run: async (input: never) => {
      const result = await t.run(input);
      return { ref: refs.add(result), result };
    },
  }));
}

const DATE_TOKEN = /\b(19|20)\d{2}(-\d{2}(-\d{2})?)?\b/g;
const words = z
  .string()
  .min(1)
  .max(120)
  .refine((s) => !/\p{Nd}/u.test(s.replace(DATE_TOKEN, "")), "Words only: a label may name a year or date, but every other number comes from the data");

const path = z.string().max(120).describe('Dot path inside the result, e.g. "rows.0.hours", "hours", "timeline". "" is the result itself.');
const valueRef = z.strictObject({ ref: z.string().describe("A ref returned with a tool result in this turn, e.g. r2."), path });
const field = z.string().min(1).max(40).describe("A field name present on every row.");

export const visualSpec = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pair"), label: words.describe('What is compared, e.g. "Listens in March against February".'), now: valueRef, before: valueRef }),
  z.strictObject({
    kind: z.literal("share"),
    label: words,
    value: valueRef.describe("A share between 0 and 1, or a part of `total`."),
    total: valueRef.optional(),
    before: valueRef.optional().describe("The same share before: between 0 and 1, or a part of `beforeTotal`."),
    beforeTotal: valueRef.optional(),
  }),
  z.strictObject({ kind: z.literal("series"), title: words, ref: z.string(), path, x: field.describe("The period or hour field."), y: field }),
  z.strictObject({ kind: z.literal("ranked"), title: words, ref: z.string(), path, value: field, limit: z.number().int().min(1).max(10).optional() }),
  z.strictObject({
    kind: z.literal("compare"),
    title: words,
    nowLabel: words,
    beforeLabel: words,
    rows: z.array(z.strictObject({ label: words, now: valueRef, before: valueRef })).min(2).max(8),
  }),
]);

export type VisualSpec = z.infer<typeof visualSpec>;

function at(value: unknown, dotted: string): unknown {
  let v = value;
  for (const key of dotted.split(".").filter(Boolean)) {
    if (v === null || typeof v !== "object") throw new ToolError(`${dotted}: nothing at ${key}`);
    v = Array.isArray(v) ? v[Number(key)] : (v as Record<string, unknown>)[key];
    if (v === undefined) throw new ToolError(`${dotted}: nothing at ${key}`);
  }
  return v;
}

function numberAt(refs: ResultRefs, r: { ref: string; path: string }): number {
  const v = at(refs.get(r.ref), r.path);
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ToolError(`${r.ref} ${r.path} is not a number`);
  return v;
}

function rowsAt(refs: ResultRefs, ref: string, dotted: string): Record<string, unknown>[] {
  const v = at(refs.get(ref), dotted);
  if (!Array.isArray(v) || v.some((r) => r === null || typeof r !== "object")) throw new ToolError(`${ref} ${dotted || "(the result)"} is not a list of rows`);
  return v as Record<string, unknown>[];
}

function numbersIn(rows: Record<string, unknown>[], key: string, where: string): number[] {
  return rows.map((r, i) => {
    const v = r[key];
    if (typeof v !== "number" || !Number.isFinite(v)) throw new ToolError(`${where}: row ${i} has no number in ${key}`);
    return v;
  });
}

const NOUNS: Record<string, string> = { uniqueSongs: "songs", uniqueArtists: "artists", uniqueTracks: "songs", minutes: "minutes" };

export function unitOf(dotted: string): Unit {
  const key = dotted.split(".").at(-1) ?? "";
  if (/hours/i.test(key)) return { type: "hours" };
  if (/rate|share/i.test(key) && !/pct/i.test(key)) return { type: "percent" };
  return { type: "count", noun: NOUNS[key] ?? key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`) };
}

function axisOf(key: string, xs: unknown[]): Axis {
  if (key === "hour" || key === "weekday") return key;
  const s = xs.map(String);
  if (s.every((x) => /^\d{4}$/.test(x))) return "year";
  if (s.every((x) => /^\d{4}-\d{2}$/.test(x))) return "month";
  if (s.every((x) => /^\d{4}-W\d{2}$/.test(x))) return "week";
  if (s.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x))) return "day";
  return "text";
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** What a row is about: a song, artist or album gets its page, artwork and actions; anything else is a plain label. */
function itemOf(row: Record<string, unknown>): Item | null {
  const songKey = str(row.songKey) ?? str(row.song);
  const artist = str(row.artist) ?? str(row.songArtist);
  if (songKey && str(row.name) && artist) return { kind: "song", songKey, name: str(row.name)!, artist, uri: null, art: null };
  if (str(row.album) && artist) return { kind: "album", name: str(row.album)!, artist, art: null };
  if (artist) return { kind: "artist", name: artist, art: null };
  for (const key of ["name", "value", "genre", "mood", "device", "source", "country", "hourBucket", "dayType", "language", "class", "period", "month", "year"]) {
    const v = row[key];
    if (typeof v === "string" || typeof v === "number") return { kind: "label", name: String(v) };
  }
  return null;
}

/** Artwork and a playable uri for the items of a ranked list: looked up, never taken from Claude. */
function withArt(db: Db, rows: { item: Item; value: number }[]) {
  const songKeys = rows.flatMap((r) => (r.item.kind === "song" ? [r.item.songKey] : []));
  const songs = new Map(
    songKeys.length
      ? db
          .all<{ song_key: string; uri: string; art: string | null }>(sql`
            select song_key, min(uri) as uri, max(album_art_url) as art from tracks
            where song_key in (${sql.join(
              songKeys.map((k) => sql`${k}`),
              sql`, `,
            )}) group by song_key`)
          .map((s) => [s.song_key, s])
      : [],
  );
  const artists = new Map(withArtistImages(db, rows.flatMap((r) => (r.item.kind === "artist" ? [{ artist: r.item.name }] : []))).map((a) => [a.artist, a.imageUrl]));
  const albumArt = (artist: string, album: string) =>
    db.get<{ art: string | null }>(sql`select max(album_art_url) as art from tracks where artist = ${artist} and album = ${album}`)?.art ?? null;
  return rows.map(({ item, value }) => {
    if (item.kind === "song") {
      const s = songs.get(item.songKey);
      return { item: { ...item, uri: s?.uri ?? null, art: s?.art ?? null }, value };
    }
    if (item.kind === "artist") return { item: { ...item, art: artists.get(item.name) ?? null }, value };
    if (item.kind === "album") return { item: { ...item, art: albumArt(item.artist, item.name) }, value };
    return { item, value };
  });
}

function unitsAgree(paths: string[], where: string): Unit {
  const units = paths.map(unitOf);
  if (units.some((u) => JSON.stringify(u) !== JSON.stringify(units[0]))) throw new ToolError(`${where}: the values measure different things`);
  return units[0]!;
}

const MAX_POINTS = 120;

/** Builds a visual from tool results by reference. Throws ToolError, which Claude sees, when a ref or path does not hold what the visual needs. */
export function resolveVisual(db: Db, refs: ResultRefs, spec: VisualSpec): Visual {
  switch (spec.kind) {
    case "pair": {
      const [now, before] = [numberAt(refs, spec.now), numberAt(refs, spec.before)];
      return { kind: "pair", label: spec.label, unit: unitsAgree([spec.now.path, spec.before.path], "pair"), now, before };
    }
    case "share": {
      const part = (value: { ref: string; path: string }, total?: { ref: string; path: string }) => {
        const v = numberAt(refs, value);
        const share = total ? v / numberAt(refs, total) : v;
        if (!(share >= 0 && share <= 1)) throw new ToolError(`share: ${value.ref} ${value.path} is not a share between 0 and 1${total ? " of the total" : ""}`);
        return share;
      };
      return { kind: "share", label: spec.label, share: part(spec.value, spec.total), before: spec.before ? part(spec.before, spec.beforeTotal) : null };
    }
    case "series": {
      const rows = rowsAt(refs, spec.ref, spec.path);
      if (rows.length < 2 || rows.length > MAX_POINTS) throw new ToolError(`series: needs 2 to ${MAX_POINTS} rows, ${spec.ref} has ${rows.length}`);
      const xs = rows.map((r, i) => {
        const x = r[spec.x];
        if (typeof x !== "string" && typeof x !== "number") throw new ToolError(`series: row ${i} has no ${spec.x}`);
        return x;
      });
      const ys = numbersIn(rows, spec.y, "series");
      const points = xs.map((x, i) => ({ x: String(x), y: ys[i]! }));
      if (axisOf(spec.x, xs) !== "text") points.sort((a, b) => (spec.x === "hour" || spec.x === "weekday" ? Number(a.x) - Number(b.x) : a.x.localeCompare(b.x)));
      return { kind: "series", title: spec.title, unit: unitOf(spec.y), axis: axisOf(spec.x, xs), points };
    }
    case "ranked": {
      const rows = rowsAt(refs, spec.ref, spec.path).slice(0, spec.limit ?? 10);
      if (rows.length === 0) throw new ToolError(`ranked: ${spec.ref} ${spec.path || "(the result)"} has no rows`);
      const values = numbersIn(rows, spec.value, "ranked");
      const items = rows.map((r, i) => {
        const item = itemOf(r);
        if (!item) throw new ToolError(`ranked: row ${i} names no song, artist, album or group`);
        return { item, value: values[i]! };
      });
      return { kind: "ranked", title: spec.title, unit: unitOf(spec.value), rows: withArt(db, items) };
    }
    case "compare": {
      const rows = spec.rows.map((r) => ({ label: r.label, now: numberAt(refs, r.now), before: numberAt(refs, r.before) }));
      return {
        kind: "compare",
        title: spec.title,
        nowLabel: spec.nowLabel,
        beforeLabel: spec.beforeLabel,
        unit: unitsAgree(
          spec.rows.flatMap((r) => [r.now.path, r.before.path]),
          "compare",
        ),
        rows,
      };
    }
  }
}

/** Visuals made in one run, by the id Claude places in its answer as [[v1]]. */
export class RunVisuals {
  readonly byId = new Map<string, Visual>();
  constructor(private readonly after: number) {}

  add(visual: Visual): string {
    const id = `v${this.after + this.byId.size + 1}`;
    this.byId.set(id, visual);
    return id;
  }
}

export const SHOW_TOOL = "show";

/**
 * The tool Claude uses to draw numbers it read: each visual names tool results by ref and the server copies the
 * values. Each visual is accepted or rejected on its own; the result echoes the values, so the prose can quote them.
 */
export function showTool(db: Db, refs: ResultRefs, visuals: RunVisuals, onVisual: (id: string, visual: Visual) => void): AgentTool {
  return tool({
    name: SHOW_TOOL,
    description:
      'Draw numbers from tool results in this turn. Each visual cites results by ref and path; the server copies the values, so a visual never holds a number you typed. Returns an id per accepted visual: place it in your answer as [[v1]]. Inline kinds sit inside a sentence: pair (now against before, one measure), share (a share of a whole, optionally against before), series (as a word-sized row of columns). Block kinds go on a line of their own: ranked (up to 10 rows of songs, artists, albums or groups by one value; songs, artists and albums link to their pages), series (a bar chart over periods or hours), compare (2 to 8 labelled rows, now against before). Rejected visuals say why; fix and call again, or leave them out.',
    schema: z.strictObject({ visuals: z.array(visualSpec).min(1).max(4) }),
    run: ({ visuals: specs }) => {
      const shown: unknown[] = [];
      const rejected: { index: number; error: string }[] = [];
      specs.forEach((spec, index) => {
        try {
          const visual = resolveVisual(db, refs, spec);
          const id = visuals.add(visual);
          onVisual(id, visual);
          shown.push({ id, ...echo(visual) });
        } catch (error) {
          if (!(error instanceof ToolError)) throw error;
          rejected.push({ index, error: error.message });
        }
      });
      return { shown, rejected };
    },
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The values a visual drew, plus what it derived (change, share as a percentage), for Claude to quote. */
function echo(v: Visual): Record<string, unknown> {
  switch (v.kind) {
    case "pair":
      return { kind: v.kind, now: v.now, before: v.before, changePct: v.before > 0 ? Math.round(((v.now - v.before) / v.before) * 100) : null };
    case "share":
      return { kind: v.kind, sharePct: r2(v.share * 100), beforePct: v.before === null ? null : r2(v.before * 100) };
    case "series":
      return { kind: v.kind, points: v.points.length, max: Math.max(...v.points.map((p) => p.y)) };
    case "ranked":
      return { kind: v.kind, rows: v.rows.length };
    case "compare":
      return { kind: v.kind, rows: v.rows.map((r) => ({ label: r.label, changePct: r.before > 0 ? Math.round(((r.now - r.before) / r.before) * 100) : null })) };
  }
}
