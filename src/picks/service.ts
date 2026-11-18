import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { picks } from "../db/schema";
import { runAgent, tool, type AgentEvent } from "../llm/agent";
import type { ChatMessage, SourcePart } from "../llm/types";
import { localNow, tagged, type FeatureContext } from "../llm/context";
import { artistKey, blockedSets, type Blocked } from "../library/blocks";
import { withArtwork } from "../library/artwork";
import { refreshPicksPlaylist } from "../living/refresh";
import { CandidateVerifier } from "../library/candidates";
import { constraintErrors, describeConstraints, withDefaults, type ConstrainedSong, type ConstraintDefaults, type Constraints } from "../library/constraints";
import { libraryTools, verifyTool } from "../library/tools";
import { localTime } from "../plays/localTime";
import { tasteProfile } from "../taste/profile";
import { isHit, pickStats } from "./outcomes";
import { picksSystem } from "./prompt";

const MAX_SEARCHES_PER_RUN = 40;
const WEB_SEARCH_MAX_USES = 15;
const RESURFACE_AFTER_MS = 28 * 86_400_000;
const HISTORY_WEEKS = 12;

const pickFields = { uri: z.string(), reason: z.string().min(1).max(400), distance: z.enum(["near", "far"]) };

export class PicksExistError extends Error {
  constructor(readonly week: string) {
    super(`Picks for the week of ${week} already exist`);
  }
}

export class PicksNotSubmittedError extends Error {
  constructor() {
    super("Claude finished without submitting picks");
  }
}

/** Monday (local) of the week containing `now`, as YYYY-MM-DD. */
export function weekOf(now: number, timezone: string): string {
  const t = localTime(now, timezone);
  const d = new Date(`${t.day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (t.weekday - 1));
  return d.toISOString().slice(0, 10);
}

type PickRow = Omit<typeof picks.$inferInsert, "id">;

function previousPicks(db: Db) {
  return db.select().from(picks).orderBy(desc(picks.createdAt), asc(picks.position)).all();
}

export type SearchSources = Map<string, string>;

/** Every page the run's web searches returned so far, url to title. */
export function searchSources(messages: ChatMessage[]): SearchSources {
  return new Map(messages.flatMap((m) => (m.role === "assistant" ? m.content.filter((p): p is SourcePart => p.type === "source").map((p) => [p.url, p.title] as const) : [])));
}

const fold = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The source must be a page this run's search returned, and its title or address must name the pick's song or artist. */
function sourceProblem(sources: SearchSources, url: string, song: { name: string; artists: string[] }): string | null {
  const title = sources.get(url);
  if (title === undefined) return "its sourceUrl is not one of the pages your web searches returned in this run";
  let path = url;
  try {
    path = decodeURIComponent(url);
  } catch {}
  const haystack = fold(`${title} ${path}`);
  const names = [song.name, ...song.artists].map(fold).filter((n) => n.length >= 3);
  if (!names.some((n) => haystack.includes(n))) return "its source page does not name the song or the artist";
  return null;
}

export function validatePicks(
  db: Db,
  blocked: Blocked,
  verifier: CandidateVerifier,
  input: { picks: { uri: string; reason: string; distance: "near" | "far"; sourceUrl?: string }[] },
  expected: { count: number; far: number },
  week: string,
  now: number,
  /** Null when the run had no web search: picks then carry no source. */
  sources: SearchSources | null,
  constraints: Constraints,
): { errors: string[]; rows: PickRow[] } {
  const errors: string[] = [];
  const rows: PickRow[] = [];
  const counted: ConstrainedSong[] = [];
  if (input.picks.length !== expected.count) errors.push(`Submit exactly ${expected.count} picks; got ${input.picks.length}.`);
  const far = input.picks.filter((p) => p.distance === "far").length;
  if (far !== expected.far) errors.push(`Exactly ${expected.far} picks must be far; got ${far}.`);
  const earlier = new Map(previousPicks(db).map((p) => [p.songKey, p]));
  const artists = new Set<string>();
  input.picks.forEach((p, i) => {
    const n = i + 1;
    const song = verifier.verified.get(p.uri);
    if (!song) return errors.push(`Pick ${n}: uri ${JSON.stringify(p.uri)} was not verified; call verify_new_song and use the uri it returns.`);
    if (song.heard) return errors.push(`Pick ${n}: the owner has already played ${song.name}.`);
    const before = earlier.get(song.songKey);
    if (before && !(before.state === "not_now" && before.createdAt <= now - RESURFACE_AFTER_MS)) {
      return errors.push(`Pick ${n}: ${song.name} was already picked in the week of ${before.week}.`);
    }
    if (blocked.songs.has(song.songKey) || song.artists.some((a) => blocked.artists.has(artistKey(a)))) return errors.push(`Pick ${n}: ${song.name} is blocked.`);
    const problem = sources ? sourceProblem(sources, p.sourceUrl ?? "", song) : null;
    if (problem) return errors.push(`Pick ${n}: ${song.name} is unsupported: ${problem}. Cite a search result that confirms the reason, or replace the pick.`);
    const artist = artistKey(song.artists[0]!);
    if (artists.has(artist)) return errors.push(`Pick ${n}: only one pick per artist (${song.artists[0]}).`);
    artists.add(artist);
    counted.push({ position: n, songKey: song.songKey, name: song.name, artists: song.artists, album: song.album || null, isNew: true });
    rows.push({
      week,
      position: n,
      uri: song.uri,
      songKey: song.songKey,
      name: song.name,
      artist: song.artists[0]!,
      album: song.album,
      releaseDate: song.releaseDate,
      albumArtUrl: song.albumArtUrl,
      reason: p.reason,
      sourceUrl: sources && p.sourceUrl ? p.sourceUrl : null,
      sourceTitle: (sources && p.sourceUrl && sources.get(p.sourceUrl)) || null,
      distance: p.distance,
      state: "new",
      stateAt: now,
      createdAt: now,
    });
  });
  errors.push(...constraintErrors(counted, constraints, "pick"));
  return { errors, rows };
}

function historyText(db: Db, now: number): string {
  const rows = previousPicks(db).filter((p) => p.createdAt > now - HISTORY_WEEKS * 7 * 86_400_000);
  if (rows.length === 0) return "No picks yet. This is the first week.";
  return rows
    .map((p) => {
      const outcome = p.plays === 0 ? "never played" : `${p.plays} plays, ${p.finished} finished, on ${p.playDays} days${p.inLibrary ? ", saved to library" : ""}`;
      const resurface = p.state === "not_now" && p.createdAt <= now - RESURFACE_AFTER_MS ? " (may come back)" : "";
      return `- week ${p.week}, ${p.distance}: ${p.name} - ${p.artist}. State ${p.state}${resurface}. ${outcome}. ${isHit(p) ? "HIT" : "not a hit"}. Reason given: ${p.reason}`;
    })
    .join("\n");
}

/** The default constraints as picks use them: every pick is new, and one pick per artist is already the rule. */
export const picksConstraints = (defaults: ConstraintDefaults): Constraints => withDefaults({ ...defaults, maxPerArtist: null, newSongs: null });

const generating = new Set<string>();

const weekHasPicks = (db: Pick<Db, "select">, week: string) => Boolean(db.select({ id: picks.id }).from(picks).where(eq(picks.week, week)).get());

export async function generatePicks(ctx: FeatureContext, onEvent?: (e: AgentEvent) => void) {
  const week = weekOf(ctx.now(), ctx.settings.get().timezone);
  if (weekHasPicks(ctx.db, week) || generating.has(week)) throw new PicksExistError(week);
  generating.add(week);
  try {
    return await generateWeek(ctx, week, onEvent);
  } finally {
    generating.delete(week);
  }
}

async function generateWeek(ctx: FeatureContext, week: string, onEvent?: (e: AgentEvent) => void) {
  const { db, llm, spotify } = ctx;
  const { timezone, weekendDays, llm: llmSettings } = ctx.settings.get();
  const now = ctx.now();
  llm.assertAvailable();
  const { picksPerWeek: count, picksFarOut: far } = llmSettings;
  const constraints = picksConstraints(llmSettings.constraints);
  const blocked = blockedSets(db);
  const verifier = new CandidateVerifier(db, spotify, blocked, MAX_SEARCHES_PER_RUN, ctx.now);
  const webSearch = llm.webSearch;
  const system = [picksSystem(webSearch), tagged("taste_profile", tasteProfile(db, { timezone, weekendDays }, now))];
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        `Choose this week's picks (week of ${week}). Owner's local time: ${localNow({ timezone, weekendDays }, now)}.`,
        `Pick exactly ${count} songs: ${count - far} near the owner's taste and ${far} further out.`,
        tagged("constraints", describeConstraints(constraints)),
        tagged("past_picks", historyText(db, now)),
      ].join("\n\n"),
    },
  ];
  let saved: PickRow[] | null = null;
  const submit = tool({
    name: "submit_picks",
    strict: true,
    description: webSearch
      ? `Save this week's ${count} picks. Each needs the uri from verify_new_song, the reason shown to the owner, whether it is near or far, and sourceUrl: the url of a web_search result from this run that confirms the music side of the reason and names the song or its artist. Returns errors to fix, or accepted: true.`
      : `Save this week's ${count} picks. Each needs the uri from verify_new_song, the reason shown to the owner, and whether it is near or far. Returns errors to fix, or accepted: true.`,
    schema: z.strictObject({
      picks: z
        .array(webSearch ? z.strictObject({ ...pickFields, sourceUrl: z.string() }) : z.strictObject(pickFields))
        .min(1)
        .max(20),
    }),
    terminal: true,
    run: (input) => {
      const { errors, rows } = validatePicks(db, blocked, verifier, input, { count, far }, week, ctx.now(), webSearch ? searchSources(messages) : null, constraints);
      if (errors.length) return { accepted: false, errors };
      db.transaction((tx) => {
        if (weekHasPicks(tx, week)) throw new PicksExistError(week);
        tx.insert(picks).values(rows).run();
      });
      saved = rows;
      return { accepted: true };
    },
  });
  await runAgent(llm, {
    feature: "picks",
    ref: `week:${week}`,
    system,
    tools: [...libraryTools(db, blocked, now, weekendDays), verifyTool(verifier), submit],
    webSearch: { maxUses: WEB_SEARCH_MAX_USES },
    messages,
    effort: "high",
    maxCalls: 40,
    onEvent,
  });
  if (!saved) throw new PicksNotSubmittedError();
  await refreshPicksPlaylist({ db, spotify, settings: ctx.settings, now: ctx.now });
  return weekPicks(db, week, ctx.now());
}

function view(p: typeof picks.$inferSelect) {
  return {
    id: p.id,
    week: p.week,
    position: p.position,
    uri: p.uri,
    songKey: p.songKey,
    name: p.name,
    artist: p.artist,
    album: p.album,
    releaseDate: p.releaseDate,
    albumArtUrl: p.albumArtUrl,
    reason: p.reason,
    source: p.sourceUrl ? { url: p.sourceUrl, title: p.sourceTitle } : null,
    distance: p.distance,
    state: p.state,
    stateAt: new Date(p.stateAt).toISOString(),
    outcome: {
      plays: p.plays,
      finished: p.finished,
      playDays: p.playDays,
      inLibrary: p.inLibrary,
      firstPlayedAt: p.firstPlayedAt ? new Date(p.firstPlayedAt).toISOString() : null,
      hit: isHit(p),
    },
  };
}

export function weekPicks(db: Db, week: string, now: number) {
  const rows = db.select().from(picks).where(eq(picks.week, week)).orderBy(asc(picks.position)).all();
  return { week, picks: pickViews(db, rows), stats: pickStats(db, now) };
}

export function pickWeeks(db: Db, limit: number) {
  return db
    .select({ week: picks.week, picks: sql<number>`count(*)`, played: sql<number>`sum(${picks.plays} > 0)` })
    .from(picks)
    .groupBy(picks.week)
    .orderBy(desc(picks.week))
    .limit(limit)
    .all();
}

export const pickViews = (db: Db, rows: (typeof picks.$inferSelect)[]) => withArtwork(db, rows.map(view));
