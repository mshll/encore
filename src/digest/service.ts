import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { digests } from "../db/schema";
import type { FeatureContext } from "../llm/context";
import { LlmBudgetExceededError, LlmNotConfiguredError } from "../llm/errors";
import { localTime } from "../plays/localTime";
import { recapCoverSource, recapCoverUrl, recapPlaylistRow } from "./cover";
import { historyStart, isRecapFacts, recapFacts, type RecapFacts } from "./facts";
import { writeLines } from "./lines";
import { recapPage, type RecapLines } from "./page";
import { baselineSpan, coveredSpan, humanDatesIn, isRecapKey, latestKey, periodLabel, periodSpan, shiftKey, type RecapKind, type Span } from "./periods";
import { definingSongs } from "./songs";
import { recapText } from "./text";

export type DigestKind = RecapKind;
type Row = typeof digests.$inferSelect;

export class DigestNotFoundError extends Error {}
/** The period cannot be recapped: it has not ended, or the history does not reach it. */
export class RecapPeriodError extends Error {}

/** `model` of a recap written without Claude: the page shows the numbers alone. */
export const CODE_RENDERED = "code";

const find = (db: Db, kind: RecapKind, key: string) =>
  db
    .select()
    .from(digests)
    .where(and(eq(digests.kind, kind), eq(digests.periodKey, key)))
    .get();

const inProgress = (d: Row) => isRecapFacts(d.facts) && (d.facts as RecapFacts).period.inProgress;

function title(d: Pick<Row, "kind" | "periodKey"> & { inProgress: boolean }): string {
  const label = periodLabel(d.kind, d.periodKey);
  const noun = d.kind === "weekly" ? "week" : d.kind === "monthly" ? "month" : "year";
  return `Your ${noun}${d.inProgress ? " so far" : ""}, ${label}`;
}

function headlineOf(d: Row): string {
  return d.lines?.headline ?? humanDatesIn(d.text.split(/\n+/).find((l) => l.trim()) ?? "").trim();
}

const item = (d: Row) => ({
  id: d.id,
  kind: d.kind,
  periodKey: d.periodKey,
  from: d.fromDay,
  to: d.toDay,
  label: periodLabel(d.kind, d.periodKey),
  title: title({ ...d, inProgress: inProgress(d) }),
  headline: headlineOf(d),
  inProgress: inProgress(d),
  createdAt: new Date(d.createdAt).toISOString(),
});

const view = (db: Db, d: Row) => ({
  ...item(d),
  text: humanDatesIn(d.text),
  facts: d.facts,
  lines: d.lines,
  model: d.model,
  page: recapPage(db, d),
});

export type RecapView = ReturnType<typeof view>;

/** The period a scheduled run writes: the week or month that just ended, and in January the year before. */
export function dueKey(kind: RecapKind, today: string, recapWeekday: number): string {
  return kind === "yearly" ? String(Number(today.slice(0, 4)) - 1) : latestKey(kind, today, recapWeekday);
}

async function linesFor(ctx: FeatureContext, page: ReturnType<typeof recapPage>, ref: string): Promise<{ lines: RecapLines | null; model: string }> {
  try {
    ctx.llm.assertAvailable();
  } catch (error) {
    if (error instanceof LlmNotConfiguredError || error instanceof LlmBudgetExceededError) return { lines: null, model: CODE_RENDERED };
    throw error;
  }
  return writeLines(ctx, page, ref);
}

/**
 * Writes the recap of one period, or returns the stored one. A stored recap is written again only to add Claude's
 * words when it has none, or to bring the current year up to yesterday. Without Claude (no key, the cap spent) the
 * recap is stored with the numbers alone. Recaps from before recaps were pages are never rewritten.
 */
export async function generateDigest(ctx: FeatureContext, kind: RecapKind, key?: string) {
  const { db } = ctx;
  const { timezone, llm: llmSettings } = ctx.settings.get();
  const today = localTime(ctx.now(), timezone).day;
  const periodKey = key ?? latestKey(kind, today, llmSettings.digestSlot.weekday);
  if (!isRecapKey(kind, periodKey)) throw new RecapPeriodError("Not a period");
  const covered = coveredSpan(kind, periodKey, today);
  if (!covered) throw new RecapPeriodError("This period has not ended yet");
  const start = historyStart(db);
  if (!start || covered.to < start) throw new RecapPeriodError("Your history does not reach this period");
  const existing = find(db, kind, periodKey);
  if (existing) {
    const stale = inProgress(existing) && existing.toDay < covered.to;
    const wordless = existing.lines === null && isRecapFacts(existing.facts) && ctx.llm.configured;
    if (!stale && !wordless) return { ...view(db, existing), created: false };
  }
  const reuse = existing && isRecapFacts(existing.facts) && existing.toDay === covered.to;
  const baseline = baselineSpan(kind, periodKey, covered);
  const facts = reuse ? (existing.facts as RecapFacts) : recapFacts(db, kind, covered, start <= baseline.from ? baseline : null);
  const stored = { kind, periodKey, fromDay: covered.from, toDay: covered.to, facts };
  const written = await linesFor(ctx, recapPage(db, { ...stored, text: "", lines: null }), `${kind}:${periodKey}`);
  if (existing && reuse && written.lines === null) return { ...view(db, existing), created: false };
  const text = recapText(recapPage(db, { ...stored, text: "", lines: written.lines }));
  const values = { ...stored, text, lines: written.lines, model: written.model, createdAt: ctx.now() };
  if (existing) db.update(digests).set(values).where(eq(digests.id, existing.id)).run();
  else db.insert(digests).values(values).onConflictDoNothing().run();
  return { ...view(db, find(db, kind, periodKey)!), created: !existing };
}

export function listDigests(db: Db, kind: RecapKind | undefined, limit: number) {
  return db
    .select()
    .from(digests)
    .where(kind ? eq(digests.kind, kind) : undefined)
    .orderBy(desc(digests.toDay), desc(digests.id))
    .limit(limit)
    .all()
    .map(item);
}

export function getDigest(db: Db, id: number): RecapView {
  const d = db.select().from(digests).where(eq(digests.id, id)).get();
  if (!d) throw new DigestNotFoundError();
  return view(db, d);
}

/** The recap as delivered elsewhere (for example Discord): title, text and the page behind it. */
export function renderDigest(db: Db, id: number) {
  const v = getDigest(db, id);
  return { ...v, rendered: `${v.title}\n\n${v.text}` };
}

/** The period's playlist: how many songs it holds, whether it is in Spotify, and its cover. Only an ended period can be saved. */
function playlistOf(db: Db, kind: RecapKind, key: string, covered: Span & { inProgress: boolean }) {
  const songs = definingSongs(db, kind, covered);
  const saved = recapPlaylistRow(db, kind, key);
  return {
    songs: songs.length,
    canSave: !covered.inProgress && songs.length > 0,
    saved: saved ? { url: saved.playlistUrl, savedAt: new Date(saved.savedAt).toISOString(), source: saved.source } : null,
    coverUrl: songs.length && !covered.inProgress ? recapCoverUrl(kind, key, recapCoverSource(kind, key, songs).key) : null,
  };
}

/**
 * One period on the timeline: what it covers today, its neighbours, and its recap when one is stored.
 * `available` says whether a recap can be made for it now.
 */
export function recapPeriod(db: Db, kind: RecapKind, key: string, today: string) {
  if (!isRecapKey(kind, key)) throw new DigestNotFoundError();
  const start = historyStart(db);
  const covered = coveredSpan(kind, key, today);
  const reaches = (k: string) => start !== null && periodSpan(kind, k).to >= start;
  const previous = shiftKey(kind, key, -1);
  const next = shiftKey(kind, key, 1);
  const stored = find(db, kind, key);
  return {
    kind,
    key,
    label: periodLabel(kind, key),
    from: covered?.from ?? periodSpan(kind, key).from,
    to: covered?.to ?? periodSpan(kind, key).to,
    inProgress: covered?.inProgress ?? false,
    available: covered !== null && reaches(key),
    reason: !reaches(key) ? "before_history" : covered === null ? "not_ended" : null,
    previous: reaches(previous) ? previous : null,
    next: coveredSpan(kind, next, today) ? next : null,
    historyStart: start,
    recap: stored ? view(db, stored) : null,
    playlist: covered && reaches(key) ? playlistOf(db, kind, key, covered) : null,
  };
}

export function isDigestDue(db: Db, kind: RecapKind, timezone: string, slot: { weekday: number; hour: number }, now: number): boolean {
  const t = localTime(now, timezone);
  if (t.hour < slot.hour) return false;
  if (kind === "weekly" && t.weekday !== slot.weekday) return false;
  if (kind === "monthly" && !t.day.endsWith("-01")) return false;
  if (kind === "yearly" && !t.day.endsWith("-01-01")) return false;
  const key = dueKey(kind, t.day, slot.weekday);
  const stored = find(db, kind, key);
  return !stored || stored.toDay < periodSpan(kind, key).to;
}
