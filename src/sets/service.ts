import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { setItems, sets } from "../db/schema";
import { runAgent, tool, type AgentEvent } from "../llm/agent";
import type { MessageParam } from "../llm/client";
import { localNow, tagged, type FeatureContext } from "../llm/context";
import { createThread, deleteThread, getThread, ownerMessage, saveThreadMessages, transcript } from "../llm/threads";
import { blockedSets, isBlocked, type Blocked } from "../library/blocks";
import { CandidateVerifier } from "../library/candidates";
import { withArtwork } from "../library/artwork";
import { loadCatalog, type CatalogSong } from "../library/catalog";
import { MOODS } from "../tags/vocabulary";
import { libraryTools, verifyTool } from "../library/tools";
import { tasteProfile } from "../taste/profile";
import { SETS_SYSTEM } from "./prompt";

const MAX_SEARCHES_PER_RUN = 30;
export const MAX_SET_ITEMS = 80;

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

export function validateSubmission(db: Db, blocked: Blocked, verifier: CandidateVerifier, input: SubmitInput): { errors: string[]; rows: ItemRow[] } {
  const catalog = loadCatalog(db);
  const errors: string[] = [];
  const rows: ItemRow[] = [];
  const seen = new Set<string>();
  input.items.forEach((item, i) => {
    const n = i + 1;
    if (item.source === "library") {
      const song = item.songKey ? catalog.songs.get(item.songKey) : undefined;
      if (!song) return errors.push(`Track ${n}: songKey ${JSON.stringify(item.songKey)} is not in the owner's history; use a songKey returned by find_songs.`);
      if (isBlocked(blocked, song.songKey, [song.artist])) return errors.push(`Track ${n}: ${song.name} is blocked by the owner.`);
      if (seen.has(song.songKey)) return errors.push(`Track ${n}: ${song.name} appears twice.`);
      const conflict = input.keep?.includes(song.songKey) ? null : directionConflict(song.tags, input.direction);
      if (conflict) return errors.push(`Track ${n}: ${song.name} conflicts with the direction (${conflict}). Replace it, or list its songKey in keep if the owner asked to keep it.`);
      seen.add(song.songKey);
      rows.push({ position: n, kind: "library", songKey: song.songKey, uri: song.uri, name: song.name, artist: song.artist, album: song.album, reason: item.reason });
      return;
    }
    const song = item.uri ? verifier.verified.get(item.uri) : undefined;
    if (!song) return errors.push(`Track ${n}: uri ${JSON.stringify(item.uri)} was not verified; call verify_new_song first and use the uri it returns.`);
    if (song.heard) return errors.push(`Track ${n}: the owner has already played ${song.name}; it cannot be a new song. Use it as a library song or replace it.`);
    if (seen.has(song.songKey)) return errors.push(`Track ${n}: ${song.name} appears twice.`);
    seen.add(song.songKey);
    rows.push({ position: n, kind: "new", songKey: song.songKey, uri: song.uri, name: song.name, artist: song.artists[0]!, album: song.album, albumArtUrl: song.albumArtUrl, reason: item.reason });
  });
  return { errors, rows };
}

function persistSet(db: Db, setId: number, input: SubmitInput, rows: ItemRow[], now: number) {
  db.transaction((tx) => {
    const current = tx.select({ version: sets.version }).from(sets).where(eq(sets.id, setId)).get()!;
    tx.update(sets)
      .set({ title: input.title, description: input.description, version: current.version + 1, updatedAt: now })
      .where(eq(sets.id, setId))
      .run();
    tx.delete(setItems).where(eq(setItems.setId, setId)).run();
    tx.insert(setItems)
      .values(rows.map((r) => ({ ...r, setId })))
      .run();
  });
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

async function converse(ctx: FeatureContext, setId: number, threadId: number, system: string[], messages: MessageParam[], onEvent?: (e: AgentEvent) => void) {
  const { db, spotify, llm } = ctx;
  const blocked = blockedSets(db);
  const verifier = new CandidateVerifier(db, spotify, blocked, MAX_SEARCHES_PER_RUN, ctx.now);
  seedVerifier(db, verifier, setId);
  const submit = tool({
    name: "submit_set",
    strict: true,
    description: "Save the complete ordered set. Call once the set is ready, and again with the full list after every refinement. Returns errors to fix, or accepted: true.",
    schema: submitInput,
    terminal: true,
    run: (input) => {
      const { errors, rows } = validateSubmission(db, blocked, verifier, input);
      if (errors.length) return { accepted: false, errors };
      persistSet(db, setId, input, rows, ctx.now());
      return { accepted: true, tracks: rows.length };
    },
  });
  const result = await runAgent(llm, {
    feature: "sets",
    ref: `set:${setId}`,
    system,
    tools: [...libraryTools(db, blocked, ctx.now()), verifyTool(verifier), submit],
    messages,
    effort: "medium",
    onEvent,
  });
  saveThreadMessages(db, threadId, messages, ctx.now());
  return result;
}

export async function createSet(ctx: FeatureContext, request: string, onEvent?: (e: AgentEvent) => void) {
  const { db, config, llm } = ctx;
  llm.assertAvailable();
  const now = ctx.now();
  const system = [SETS_SYSTEM, tagged("taste_profile", tasteProfile(db, config.timezone, now))];
  const messages: MessageParam[] = [{ role: "user", content: `${ownerMessage(request)}\nOwner's local time: ${localNow(config.timezone, now)}.` }];
  const { setId, threadId } = db.transaction((tx) => {
    const threadId = createThread(tx, "sets", system, [], now);
    const setId = tx
      .insert(sets)
      .values({ threadId, request, title: "Untitled set", description: "", version: 0, createdAt: now, updatedAt: now })
      .returning({ id: sets.id })
      .get().id;
    return { setId, threadId };
  });
  let result;
  try {
    result = await converse(ctx, setId, threadId, system, messages, onEvent);
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
    super("Claude finished without submitting a set");
  }
}

export async function refineSet(ctx: FeatureContext, setId: number, message: string, onEvent?: (e: AgentEvent) => void) {
  const { db, config, llm } = ctx;
  const row = getSetRow(db, setId);
  if (!row) throw new SetNotFoundError();
  llm.assertAvailable();
  const thread = getThread(db, row.threadId)!;
  const messages = thread.messages;
  messages.push({ role: "user", content: `${ownerMessage(message)}\nOwner's local time: ${localNow(config.timezone, ctx.now())}.` });
  const before = row.version;
  const result = await converse(ctx, setId, row.threadId, thread.system, messages, onEvent);
  return { set: getSet(db, setId)!, changed: getSetRow(db, setId)!.version !== before, reply: result.terminal ? null : textReply(result.final.content) };
}

function textReply(content: { type: string }[]): string | null {
  const text = content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return text || null;
}

const getSetRow = (db: Db, id: number) => db.select().from(sets).where(eq(sets.id, id)).get();

function deleteSetRows(db: Db, setId: number) {
  const row = getSetRow(db, setId);
  if (!row) return;
  db.transaction((tx) => {
    tx.delete(setItems).where(eq(setItems.setId, setId)).run();
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
  return { items: rows.map((r) => ({ ...summary(r), tracks: counts.get(r.id) ?? 0 })), total, limit, offset };
}

export function getSet(db: Db, setId: number) {
  const row = getSetRow(db, setId);
  if (!row) return null;
  const items = db.select().from(setItems).where(eq(setItems.setId, setId)).orderBy(asc(setItems.position)).all();
  return {
    ...summary(row),
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
        outcome: { plays: i.playsAfter, finished: i.finished, skipped: i.skipped, firstPlayedAt: i.firstPlayedAt ? new Date(i.firstPlayedAt).toISOString() : null },
      })),
    ),
    conversation: transcript(getThread(db, row.threadId)?.messages ?? []),
  };
}
