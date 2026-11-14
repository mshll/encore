import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { picks } from "../db/schema";
import { getJobState, setJobState } from "../jobs/state";
import { runAgent, tool, type AgentEvent } from "../llm/agent";
import type { MessageParam } from "../llm/client";
import { localNow, tagged, type FeatureContext } from "../llm/context";
import { artistKey, blockedSets, type Blocked } from "../library/blocks";
import { CandidateVerifier } from "../library/candidates";
import { libraryTools, verifyTool } from "../library/tools";
import { localTime } from "../plays/localTime";
import { playlistDescription } from "../sets/playlist";
import type { SpotifyClient } from "../spotify/client";
import { tasteProfile } from "../taste/profile";
import { isHit, pickStats } from "./outcomes";
import { PICKS_SYSTEM } from "./prompt";

const MAX_SEARCHES_PER_RUN = 40;
const WEB_SEARCH_MAX_USES = 15;
const RESURFACE_AFTER_MS = 28 * 86_400_000;
const HISTORY_WEEKS = 12;
const PLAYLIST_STATE = "picks_playlist";

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

export function validatePicks(
  db: Db,
  blocked: Blocked,
  verifier: CandidateVerifier,
  input: { picks: { uri: string; reason: string; distance: "near" | "far" }[] },
  expected: { count: number; far: number },
  week: string,
  now: number,
): { errors: string[]; rows: PickRow[] } {
  const errors: string[] = [];
  const rows: PickRow[] = [];
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
    const artist = artistKey(song.artists[0]!);
    if (artists.has(artist)) return errors.push(`Pick ${n}: only one pick per artist (${song.artists[0]}).`);
    artists.add(artist);
    rows.push({
      week,
      position: n,
      uri: song.uri,
      songKey: song.songKey,
      name: song.name,
      artist: song.artists[0]!,
      album: song.album,
      releaseDate: song.releaseDate,
      reason: p.reason,
      distance: p.distance,
      state: "new",
      stateAt: now,
      createdAt: now,
    });
  });
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

export async function generatePicks(ctx: FeatureContext, onEvent?: (e: AgentEvent) => void) {
  const { db, config, llm, spotify } = ctx;
  const now = ctx.now();
  const week = weekOf(now, config.timezone);
  if (db.select({ id: picks.id }).from(picks).where(eq(picks.week, week)).get()) throw new PicksExistError(week);
  llm.assertAvailable();
  const { picksPerWeek: count, picksFarOut: far } = config.llm;
  const blocked = blockedSets(db);
  const verifier = new CandidateVerifier(db, spotify, blocked, MAX_SEARCHES_PER_RUN, ctx.now);
  const system = [PICKS_SYSTEM, tagged("taste_profile", tasteProfile(db, config.timezone, now))];
  const messages: MessageParam[] = [
    {
      role: "user",
      content: [
        `Choose this week's picks (week of ${week}). Owner's local time: ${localNow(config.timezone, now)}.`,
        `Pick exactly ${count} songs: ${count - far} near the owner's taste and ${far} further out.`,
        tagged("past_picks", historyText(db, now)),
      ].join("\n\n"),
    },
  ];
  let saved: PickRow[] | null = null;
  const submit = tool({
    name: "submit_picks",
    strict: true,
    description: `Save this week's ${count} picks. Each needs the uri from verify_new_song, the reason shown to the owner, and whether it is near or far. Returns errors to fix, or accepted: true.`,
    schema: z.strictObject({
      picks: z.array(z.strictObject({ uri: z.string(), reason: z.string().min(1).max(400), distance: z.enum(["near", "far"]) })).min(1).max(20),
    }),
    terminal: true,
    run: (input) => {
      const { errors, rows } = validatePicks(db, blocked, verifier, input, { count, far }, week, ctx.now());
      if (errors.length) return { accepted: false, errors };
      db.transaction((tx) => {
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
    tools: [...libraryTools(db, blocked, now), verifyTool(verifier), submit],
    serverTools: [{ type: "web_search_20260209", name: "web_search", max_uses: WEB_SEARCH_MAX_USES }],
    messages,
    effort: "high",
    maxCalls: 40,
    onEvent,
  });
  if (!saved) throw new PicksNotSubmittedError();
  if (config.llm.picksPlaylist) await syncPicksPlaylist(db, spotify, config.timezone, ctx.now());
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
    reason: p.reason,
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
  return { week, picks: rows.map(view), stats: pickStats(db, now) };
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

export const pickView = view;

/** Mirrors the current week's picks (except "never") into one private playlist, updated in place. */
export async function syncPicksPlaylist(db: Db, spotify: SpotifyClient, timezone: string, now: number) {
  const week = weekOf(now, timezone);
  const uris = db
    .select()
    .from(picks)
    .where(eq(picks.week, week))
    .orderBy(asc(picks.position))
    .all()
    .filter((p) => p.state !== "never")
    .map((p) => p.uri);
  const details = { name: "encore picks", description: playlistDescription(`Weekly picks for the week of ${week}.`) };
  let state = getJobState(db, PLAYLIST_STATE)?.data as { playlistId: string; url: string } | undefined;
  if (!state) {
    const created = await spotify.createPlaylist({ ...details, public: false });
    state = { playlistId: created.id, url: created.external_urls.spotify };
    setJobState(db, PLAYLIST_STATE, { lastSuccessAt: now, data: state });
  } else {
    await spotify.updatePlaylistDetails(state.playlistId, details);
  }
  await spotify.replacePlaylistItems(state.playlistId, uris);
  return { ...state, tracks: uris.length };
}

export function picksPlaylist(db: Db) {
  return (getJobState(db, PLAYLIST_STATE)?.data as { playlistId: string; url: string } | undefined) ?? null;
}
