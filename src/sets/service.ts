import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { musicWhere, songStatsSql, type SongRow } from "../analytics/common";
import { z } from "zod";
import type { Db } from "../db/client";
import { setChanges, setItems, sets, type SetChangeMove, type SetChangeTrack } from "../db/schema";
import { runAgent, tool, type AgentEvent } from "../llm/agent";
import { replyText, type ChatMessage } from "../llm/types";
import { localNow, tagged, type FeatureContext } from "../llm/context";
import { pageContextNote, type PageContext } from "../llm/pageContext";
import { leaksInternals } from "../llm/plainText";
import { createThread, deleteThread, getThread, ownerMessage, saveThreadMessages, transcript } from "../llm/threads";
import { artistKey, blockedSets, isBlocked, type Blocked } from "../library/blocks";
import { CandidateVerifier } from "../library/candidates";
import { constraintErrors, constraintsPatch, constraintsSchema, describeConstraints, MAX_SET_ITEMS, NO_CONSTRAINTS, withDefaults, type ConstrainedSong, type Constraints, type ConstraintsPatch } from "../library/constraints";
import { withArtwork } from "../library/artwork";
import { loadCatalog, type CatalogSong } from "../library/catalog";
import { MOODS } from "../tags/vocabulary";
import { libraryTools, verifyTool } from "../library/tools";
import { tasteProfile } from "../taste/profile";
import { coverUrl, setCoverSources } from "./cover";
import { setDjOutcomes } from "./play";
import { SETS_SYSTEM } from "./prompt";

const MAX_SEARCHES_PER_RUN = 30;

const submitInput = z.strictObject({
  title: z.string().min(1).max(80),
  description: z.string().max(280).describe("One or two sentences about the moment this set is for."),
  items: z
    .array(
      z.strictObject({
        source: z.enum(["library", "new"]),
        songKey: z.string().optional().describe("For library songs: the songKey from find_songs."),
        uri: z.string().optional().describe("For new songs: the uri from verify_new_song."),
        reason: z.string().min(1).max(240),
      }),
    )
    .min(1)
    .max(MAX_SET_ITEMS),
  direction: z
    .strictObject({
      avoidMoods: z.array(z.enum(MOODS)).optional(),
      valenceMin: z.number().int().min(1).max(5).optional(),
      valenceMax: z.number().int().min(1).max(5).optional(),
      energyMin: z.number().int().min(1).max(5).optional(),
      energyMax: z.number().int().min(1).max(5).optional(),
    })
    .optional()
    .describe(
      "Limits every track must meet, gathered from all of the owner's messages so far, e.g. 'less sad' -> avoidMoods [sad, melancholic] and valenceMin 3. Checked against each familiar song's tags (valence and energy 1-5).",
    ),
  keep: z.array(z.string()).optional().describe("songKeys the owner explicitly asked to keep; they are exempt from direction."),
});

type Direction = NonNullable<z.infer<typeof submitInput>["direction"]>;

/** Why a tagged song breaks the direction, or null. Untagged songs pass: the model judges them. */
export function directionConflict(tags: CatalogSong["tags"], d: Direction | undefined): string | null {
  if (!d || !tags) return null;
  const moods = d.avoidMoods?.filter((m) => tags.moods.includes(m)) ?? [];
  if (moods.length) return `tagged ${moods.join(", ")}`;
  if (d.valenceMin !== undefined && tags.valence < d.valenceMin) return `valence ${tags.valence} is below ${d.valenceMin}`;
  if (d.valenceMax !== undefined && tags.valence > d.valenceMax) return `valence ${tags.valence} is above ${d.valenceMax}`;
  if (d.energyMin !== undefined && tags.energy < d.energyMin) return `energy ${tags.energy} is below ${d.energyMin}`;
  if (d.energyMax !== undefined && tags.energy > d.energyMax) return `energy ${tags.energy} is above ${d.energyMax}`;
  return null;
}

type SubmitInput = z.infer<typeof submitInput>;

type ItemRow = Omit<typeof setItems.$inferInsert, "id" | "setId">;

export class SetNotFoundError extends Error {}

export function validateSubmission(
  db: Db,
  blocked: Blocked,
  verifier: CandidateVerifier,
  input: SubmitInput,
  weekendDays: readonly number[],
  constraints: Constraints,
): { errors: string[]; rows: ItemRow[] } {
  const catalog = loadCatalog(db, weekendDays);
  const errors: string[] = [];
  const rows: ItemRow[] = [];
  const counted: ConstrainedSong[] = [];
  const seen = new Set<string>();
  input.items.forEach((item, i) => {
    const n = i + 1;
    if (leaksInternals(item.reason)) return errors.push(`Track ${n}: write the reason in plain words, without tool names, field names or ids such as wrong_moment.`);
    if (item.source === "library") {
      const song = item.songKey ? catalog.songs.get(item.songKey) : undefined;
      if (!song) return errors.push(`Track ${n}: songKey ${JSON.stringify(item.songKey)} is not in the owner's history; use a songKey returned by find_songs.`);
      if (isBlocked(blocked, song.songKey, [song.artist])) return errors.push(`Track ${n}: ${song.name} is blocked by the owner.`);
      if (seen.has(song.songKey)) return errors.push(`Track ${n}: ${song.name} appears twice.`);
      const conflict = input.keep?.includes(song.songKey) ? null : directionConflict(song.tags, input.direction);
      if (conflict) return errors.push(`Track ${n}: ${song.name} conflicts with the direction (${conflict}). Replace it, or list its songKey in keep if the owner asked to keep it.`);
      seen.add(song.songKey);
      rows.push({ position: n, kind: "library", songKey: song.songKey, uri: song.uri, name: song.name, artist: song.artist, album: song.album, reason: item.reason });
      counted.push({ position: n, songKey: song.songKey, name: song.name, artists: [song.artist], album: song.album, isNew: false });
      return;
    }
    const song = item.uri ? verifier.verified.get(item.uri) : undefined;
    if (!song) return errors.push(`Track ${n}: uri ${JSON.stringify(item.uri)} was not verified; call verify_new_song first and use the uri it returns.`);
    if (song.heard) return errors.push(`Track ${n}: the owner has already played ${song.name}; it cannot be a new song. Use it as a library song or replace it.`);
    if (seen.has(song.songKey)) return errors.push(`Track ${n}: ${song.name} appears twice.`);
    seen.add(song.songKey);
    rows.push({ position: n, kind: "new", songKey: song.songKey, uri: song.uri, name: song.name, artist: song.artists[0]!, album: song.album, albumArtUrl: song.albumArtUrl, reason: item.reason });
    counted.push({ position: n, songKey: song.songKey, name: song.name, artists: song.artists, album: song.album || null, isNew: true });
  });
  errors.push(...constraintErrors(counted, constraints));
  return { errors, rows };
}

type Change = { source: "claude" | "owner"; message: string | null };
type Listed = { songKey: string; name: string; artist: string };

/** Longest increasing subsequence of `xs`, as the set of indexes into `xs` that belong to it. */
function increasingRun(xs: number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(xs.length).fill(-1);
  xs.forEach((x, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[tails[mid]!]! < x) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) keep.add(i);
  return keep;
}

/** Songs added, removed and moved between two orderings. Moved: kept songs outside the longest run whose relative order did not change. */
export function diffSets(before: Listed[], after: Listed[]): { added: SetChangeTrack[]; removed: SetChangeTrack[]; moved: SetChangeMove[] } {
  const pick = (t: Listed): SetChangeTrack => ({ songKey: t.songKey, name: t.name, artist: t.artist });
  const oldIndex = new Map(before.map((t, i) => [t.songKey, i]));
  const newKeys = new Set(after.map((t) => t.songKey));
  const kept = after.map((t, i) => ({ t, to: i + 1, from: (oldIndex.get(t.songKey) ?? -1) + 1 })).filter((k) => k.from > 0);
  const run = increasingRun(kept.map((k) => k.from));
  return {
    added: after.filter((t) => !oldIndex.has(t.songKey)).map(pick),
    removed: before.filter((t) => !newKeys.has(t.songKey)).map(pick),
    moved: kept.filter((_, i) => !run.has(i)).map((k) => ({ ...pick(k.t), from: k.from, to: k.to })),
  };
}

function persistSet(db: Db, setId: number, input: SubmitInput, rows: ItemRow[], now: number, change: Change) {
  db.transaction((tx) => {
    const current = tx.select({ version: sets.version }).from(sets).where(eq(sets.id, setId)).get()!;
    const before = tx.select().from(setItems).where(eq(setItems.setId, setId)).orderBy(asc(setItems.position)).all();
    const pinned = new Set(before.filter((i) => i.pinned).map((i) => i.songKey));
    const version = current.version + 1;
    tx.update(sets).set({ title: input.title, description: input.description, version, updatedAt: now }).where(eq(sets.id, setId)).run();
    tx.delete(setItems).where(eq(setItems.setId, setId)).run();
    tx.insert(setItems)
      .values(rows.map((r) => ({ ...r, setId, pinned: pinned.has(r.songKey) })))
      .run();
    if (current.version > 0)
      tx.insert(setChanges)
        .values({ setId, version, ...change, ...diffSets(before, rows), createdAt: now })
        .run();
  });
}

/** Songs the owner pinned that a submission left out. */
function missingPinned(db: Db, setId: number, rows: ItemRow[]): string[] {
  const keys = new Set(rows.map((r) => r.songKey));
  return pinnedItems(db, setId)
    .filter((i) => !keys.has(i.songKey))
    .map((i) => `${i.name} (songKey ${i.songKey}) is pinned by the owner and must stay in the set.`);
}

const pinnedItems = (db: Db, setId: number) =>
  db
    .select()
    .from(setItems)
    .where(eq(setItems.setId, setId))
    .all()
    .filter((i) => i.pinned);

export class SetItemNotFoundError extends Error {}

/** Removes one track by its position; the set gets a new version, so a saved playlist becomes outdated. */
export function removeSetItem(db: Db, setId: number, position: number, now: number) {
  const row = getSetRow(db, setId);
  if (!row) throw new SetNotFoundError();
  const before = db.select().from(setItems).where(eq(setItems.setId, setId)).orderBy(asc(setItems.position)).all();
  const target = before.find((i) => i.position === position);
  if (!target) throw new SetItemNotFoundError();
  const after = before.filter((i) => i !== target);
  db.transaction((tx) => {
    tx.delete(setItems).where(eq(setItems.id, target.id)).run();
    after.forEach((item, i) =>
      tx
        .update(setItems)
        .set({ position: i + 1 })
        .where(eq(setItems.id, item.id))
        .run(),
    );
    tx.update(sets)
      .set({ version: row.version + 1, updatedAt: now })
      .where(eq(sets.id, setId))
      .run();
    tx.insert(setChanges)
      .values({ setId, version: row.version + 1, source: "owner", message: null, ...diffSets(before, after), createdAt: now })
      .run();
  });
  return getSet(db, setId)!;
}

/** Pins or unpins one track. A pinned track stays through later refinements. Does not change the version. */
export function pinSetItem(db: Db, setId: number, position: number, pinned: boolean) {
  if (!getSetRow(db, setId)) throw new SetNotFoundError();
  const item = db
    .select()
    .from(setItems)
    .where(eq(setItems.setId, setId))
    .all()
    .find((i) => i.position === position);
  if (!item) throw new SetItemNotFoundError();
  db.update(setItems).set({ pinned }).where(eq(setItems.id, item.id)).run();
  return getSet(db, setId)!;
}

function seedVerifier(db: Db, verifier: CandidateVerifier, setId: number) {
  for (const item of db.select().from(setItems).where(eq(setItems.setId, setId)).all()) {
    if (item.kind !== "new") continue;
    verifier.verified.set(item.uri, {
      uri: item.uri,
      songKey: item.songKey,
      name: item.name,
      artists: [item.artist],
      album: item.album ?? "",
      albumArtUrl: item.albumArtUrl,
      releaseDate: null,
      durationMs: 0,
      heard: false,
      plays: 0,
    });
  }
}

/** Blocks plus the set's exclusions, so find_songs leaves out what the set cannot use. Refilled in place when the exclusions change. */
function fillHidden(hidden: Blocked, blocked: Blocked, c: Constraints) {
  hidden.songs.clear();
  hidden.artists.clear();
  for (const k of [...blocked.songs, ...c.exclude.songs.map((s) => s.songKey)]) hidden.songs.add(k);
  for (const k of [...blocked.artists, ...c.exclude.artists.map(artistKey)]) hidden.artists.add(k);
}

async function converse(ctx: FeatureContext, setId: number, threadId: number, system: string[], messages: ChatMessage[], change: Change, onEvent?: (e: AgentEvent) => void) {
  const { db, spotify, llm } = ctx;
  const blocked = blockedSets(db);
  const verifier = new CandidateVerifier(db, spotify, blocked, MAX_SEARCHES_PER_RUN, ctx.now);
  seedVerifier(db, verifier, setId);
  let constraints = setConstraints(getSetRow(db, setId)!);
  const hidden: Blocked = { songs: new Set(), artists: new Set() };
  fillHidden(hidden, blocked, constraints);
  const updateConstraints = tool({
    name: "set_constraints",
    description:
      "Change this set's constraints, only when the owner's latest message asks for it (for example 'max 2 per artist' or 'no Drake'). Never use it to make a submission pass. Fields you leave out keep their value; exclude replaces both lists. Returns the constraints now in force.",
    schema: constraintsPatch,
    run: (patch) => {
      constraints = { ...constraints, ...patch };
      db.update(sets).set({ constraints }).where(eq(sets.id, setId)).run();
      fillHidden(hidden, blocked, constraints);
      return { constraints };
    },
  });
  const submit = tool({
    name: "submit_set",
    strict: true,
    description: "Save the complete ordered set. Call once the set is ready, and again with the full list after every refinement. Returns errors to fix, or accepted: true.",
    schema: submitInput,
    terminal: true,
    run: (input) => {
      const { errors, rows } = validateSubmission(db, blocked, verifier, input, ctx.settings.get().weekendDays, constraints);
      errors.push(...missingPinned(db, setId, rows));
      if (errors.length) return { accepted: false, errors };
      persistSet(db, setId, input, rows, ctx.now(), change);
      return { accepted: true, tracks: rows.length };
    },
  });
  const result = await runAgent(llm, {
    feature: "sets",
    ref: `set:${setId}`,
    system,
    tools: [...libraryTools(db, hidden, ctx.now(), ctx.settings.get().weekendDays), verifyTool(verifier), updateConstraints, submit],
    messages,
    effort: "medium",
    onEvent,
  });
  saveThreadMessages(db, threadId, messages, ctx.now());
  return result;
}

export async function createSet(ctx: FeatureContext, request: string, onEvent?: (e: AgentEvent) => void, context?: PageContext, given?: ConstraintsPatch, note = "") {
  const { db, llm } = ctx;
  llm.assertAvailable();
  const { timezone, weekendDays, llm: llmSettings } = ctx.settings.get();
  const constraints = withDefaults(llmSettings.constraints, given);
  const now = ctx.now();
  const system = [SETS_SYSTEM, tagged("taste_profile", tasteProfile(db, { timezone, weekendDays }, now))];
  const messages: ChatMessage[] = [
    { role: "user", content: `${ownerMessage(request)}\nOwner's local time: ${localNow({ timezone, weekendDays }, now)}.${constraintsNote(constraints)}${pageContextNote(context)}${note}` },
  ];
  const { setId, threadId } = db.transaction((tx) => {
    const threadId = createThread(tx, "sets", system, [], now);
    const setId = tx
      .insert(sets)
      .values({ threadId, request, title: "Untitled set", description: "", version: 0, constraints, createdAt: now, updatedAt: now })
      .returning({ id: sets.id })
      .get().id;
    return { setId, threadId };
  });
  let result;
  try {
    result = await converse(ctx, setId, threadId, system, messages, { source: "claude", message: request }, onEvent);
  } catch (error) {
    deleteSetRows(db, setId);
    throw error;
  }
  const reply = result.terminal ? null : textReply(result.final.content);
  if (getSetRow(db, setId)!.version === 0 && !reply) {
    deleteSetRows(db, setId);
    throw new SetNotBuiltError();
  }
  return { set: getSet(db, setId)!, reply };
}

export class SetNotBuiltError extends Error {
  constructor() {
    super("The AI finished without submitting a set");
  }
}

export async function refineSet(ctx: FeatureContext, setId: number, message: string, onEvent?: (e: AgentEvent) => void, context?: PageContext, note = "") {
  const { db, llm } = ctx;
  const row = getSetRow(db, setId);
  if (!row) throw new SetNotFoundError();
  llm.assertAvailable();
  const thread = getThread(db, row.threadId)!;
  const messages = thread.messages;
  const pinned = pinnedItems(db, setId);
  const pins = pinned.length ? `\nPinned by the owner, keep in the set: ${pinned.map((i) => `${i.name} - ${i.artist} (songKey ${i.songKey})`).join("; ")}.` : "";
  messages.push({ role: "user", content: `${ownerMessage(message)}\nOwner's local time: ${localNow(ctx.settings.get(), ctx.now())}.${pins}${constraintsNote(setConstraints(row))}${pageContextNote(context)}${note}` });
  const before = row.version;
  const result = await converse(ctx, setId, row.threadId, thread.system, messages, { source: "claude", message }, onEvent);
  return { set: getSet(db, setId)!, changed: getSetRow(db, setId)!.version !== before, reply: result.terminal ? null : textReply(result.final.content) };
}

const textReply = (content: Parameters<typeof replyText>[0]): string | null => replyText(content) || null;

const getSetRow = (db: Db, id: number) => db.select().from(sets).where(eq(sets.id, id)).get();

export const setConstraints = (row: Pick<typeof sets.$inferSelect, "constraints">): Constraints => row.constraints ?? NO_CONSTRAINTS;

const constraintsNote = (c: Constraints) => `\n${tagged("set_constraints", describeConstraints(c))}`;

/** Changes the constraints the next refinement must meet. The songs and the version stay as they are. */
export function updateSetConstraints(db: Db, setId: number, patch: ConstraintsPatch) {
  const row = getSetRow(db, setId);
  if (!row) throw new SetNotFoundError();
  const constraints = constraintsSchema.parse({ ...setConstraints(row), ...patch });
  db.update(sets).set({ constraints }).where(eq(sets.id, setId)).run();
  return getSet(db, setId)!;
}

function deleteSetRows(db: Db, setId: number) {
  const row = getSetRow(db, setId);
  if (!row) return;
  db.transaction((tx) => {
    tx.delete(setItems).where(eq(setItems.setId, setId)).run();
    tx.delete(setChanges).where(eq(setChanges.setId, setId)).run();
    tx.delete(sets).where(eq(sets.id, setId)).run();
    deleteThread(tx, row.threadId);
  });
}

export function deleteSet(db: Db, setId: number) {
  if (!getSetRow(db, setId)) throw new SetNotFoundError();
  deleteSetRows(db, setId);
}

function summary(row: typeof sets.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    request: row.request,
    version: row.version,
    constraints: setConstraints(row),
    conversationId: row.conversationId,
    playlist: row.playlistId ? { id: row.playlistId, url: row.playlistUrl, savedVersion: row.savedVersion, outdated: row.savedVersion !== row.version } : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export function listSets(db: Db, limit: number, offset: number) {
  const rows = db.select().from(sets).orderBy(desc(sets.updatedAt), desc(sets.id)).limit(limit).offset(offset).all();
  const counts = new Map(
    db
      .select({ setId: setItems.setId, n: sql<number>`count(*)` })
      .from(setItems)
      .groupBy(setItems.setId)
      .all()
      .map((r) => [r.setId, r.n]),
  );
  const total = db.select({ n: sql<number>`count(*)` }).from(sets).get()?.n ?? 0;
  const ids = rows.map((r) => r.id);
  const firsts = ids.length ? db.select().from(setItems).where(and(inArray(setItems.setId, ids), lte(setItems.position, 4))).orderBy(asc(setItems.position)).all() : [];
  const covers = new Map<number, string[]>();
  for (const item of withArtwork(db, firsts)) if (item.albumArtUrl) covers.set(item.setId, [...(covers.get(item.setId) ?? []), item.albumArtUrl]);
  const sources = setCoverSources(db, rows);
  const cover = (id: number) => {
    const source = sources.get(id);
    return source ? coverUrl(id, source.key) : null;
  };
  return { items: rows.map((r) => ({ ...summary(r), coverUrl: cover(r.id), tracks: counts.get(r.id) ?? 0, covers: covers.get(r.id) ?? [] })), total, limit, offset };
}

export function getSet(db: Db, setId: number) {
  const row = getSetRow(db, setId);
  if (!row) return null;
  const items = db.select().from(setItems).where(eq(setItems.setId, setId)).orderBy(asc(setItems.position)).all();
  const dj = setDjOutcomes(db, setId);
  const keys = [...new Set(items.filter((i) => i.kind === "library").map((i) => i.songKey))];
  const played = keys.length ? db.all<SongRow>(songStatsSql(musicWhere({}, inArray(sql`t.song_key`, keys)))) : [];
  const stats = new Map(played.map((r) => [r.song_key, r]));
  const history = (songKey: string) => {
    const song = stats.get(songKey);
    return song ? { listens: song.listens, lastPlayed: new Date(song.last_ts!).toISOString() } : null;
  };
  const source = setCoverSources(db, [row]).get(setId);
  return {
    ...summary(row),
    coverUrl: source ? coverUrl(setId, source.key) : null,
    djSessions: dj.sessions,
    items: withArtwork(
      db,
      items.map((i) => ({
        position: i.position,
        kind: i.kind,
        songKey: i.songKey,
        uri: i.uri,
        name: i.name,
        artist: i.artist,
        album: i.album,
        albumArtUrl: i.albumArtUrl,
        reason: i.reason,
        pinned: i.pinned,
        history: i.kind === "library" ? history(i.songKey) : null,
        outcome: { plays: i.playsAfter, finished: i.finished, skipped: i.skipped, firstPlayedAt: i.firstPlayedAt ? new Date(i.firstPlayedAt).toISOString() : null },
        dj: dj.byUri.get(i.uri) ?? { finished: 0, skipped: 0 },
      })),
    ),
    conversation: transcript(getThread(db, row.threadId)?.messages ?? []),
    changes: db
      .select()
      .from(setChanges)
      .where(eq(setChanges.setId, setId))
      .orderBy(asc(setChanges.version))
      .all()
      .map((c) => ({ version: c.version, source: c.source, message: c.message, added: c.added, removed: c.removed, moved: c.moved, at: new Date(c.createdAt).toISOString() })),
  };
}
