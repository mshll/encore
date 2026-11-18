import { and, desc, eq, sql } from "drizzle-orm";
import { randomId, sha256 } from "../auth/secrets";
import { makeAnswerCard } from "../answers/card";
import { askAnswer } from "../ask/service";
import { makeCard } from "../covers/card";
import type { Db } from "../db/client";
import { shares, type SHARE_KINDS } from "../db/schema";
import { getDigest } from "../digest/service";
import { answerSnapshot, recapSnapshot, type ShareSnapshot } from "./snapshot";

export type ShareKind = (typeof SHARE_KINDS)[number];
export type ShareRow = typeof shares.$inferSelect;

export class ShareNotFoundError extends Error {}

/** 32 random bytes from the CSPRNG, base64url: 43 characters, 256 bits. Only its SHA-256 is stored. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;
export const MAX_EXPIRY_DAYS = 365;

const hashToken = (token: string) => sha256(token).toString("hex");

export const shareUrl = (publicBaseUrl: string, token: string) => `${publicBaseUrl}/s/${token}`;

function status(row: ShareRow, now: number): "active" | "expired" | "revoked" {
  if (row.revokedAt !== null) return "revoked";
  if (row.expiresAt !== null && row.expiresAt <= now) return "expired";
  return "active";
}

const iso = (ts: number | null) => (ts === null ? null : new Date(ts).toISOString());

/** A link as the owner sees it. The token is not in it: it was shown once, when the link was made. */
export function shareView(row: ShareRow, now: number) {
  return {
    id: row.id,
    kind: row.kind,
    ref: row.refId,
    turn: row.refIndex,
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: iso(row.expiresAt),
    revokedAt: iso(row.revokedAt),
    views: row.views,
    lastViewedAt: iso(row.lastViewedAt),
    status: status(row, now),
  };
}

/** What a link points at: a recap by id, or an answer by its thread and turn. */
export type ShareTarget = { kind: "recap"; ref: number } | { kind: "answer"; ref: number; turn: number };

function snapshotOf(db: Db, target: ShareTarget): ShareSnapshot {
  if (target.kind === "recap") return recapSnapshot(getDigest(db, target.ref).page);
  const { question, answer } = askAnswer(db, target.ref, target.turn);
  return answerSnapshot(question, answer);
}

/**
 * Makes a public link to a frozen copy of a recap or an answer, only on the owner's explicit action. Returns the token
 * once; encore keeps only its hash, so the link cannot be shown again, only revoked.
 */
export function createShare(db: Db, input: ShareTarget & { expiresInDays?: number | null }, now: number): { token: string; row: ShareRow } {
  const snapshot = snapshotOf(db, input);
  const token = randomId(32);
  const row = db
    .insert(shares)
    .values({
      tokenHash: hashToken(token),
      kind: input.kind,
      refId: input.ref,
      refIndex: input.kind === "answer" ? input.turn : null,
      snapshot,
      createdAt: now,
      expiresAt: input.expiresInDays ? now + input.expiresInDays * DAY_MS : null,
      revokedAt: null,
      views: 0,
      lastViewedAt: null,
    })
    .returning()
    .get();
  return { token, row };
}

export function listShares(db: Db, filter: { kind?: ShareKind; ref?: number; turn?: number }) {
  return db
    .select()
    .from(shares)
    .where(
      and(
        filter.kind ? eq(shares.kind, filter.kind) : undefined,
        filter.ref !== undefined ? eq(shares.refId, filter.ref) : undefined,
        filter.turn !== undefined ? eq(shares.refIndex, filter.turn) : undefined,
      ),
    )
    .orderBy(desc(shares.createdAt), desc(shares.id))
    .all();
}

export function revokeShare(db: Db, id: number, now: number): ShareRow {
  const row = db.select().from(shares).where(eq(shares.id, id)).get();
  if (!row) throw new ShareNotFoundError();
  if (row.revokedAt === null) db.update(shares).set({ revokedAt: now }).where(eq(shares.id, id)).run();
  return db.select().from(shares).where(eq(shares.id, id)).get()!;
}

/** The live share a token opens, or null for a token that is malformed, unknown, revoked or expired: all look the same. */
export function resolveShare(db: Db, token: string, now: number): ShareRow | null {
  if (!TOKEN_SHAPE.test(token)) return null;
  const row = db.select().from(shares).where(eq(shares.tokenHash, hashToken(token))).get();
  return row && status(row, now) === "active" ? row : null;
}

export function countView(db: Db, id: number, now: number) {
  db.update(shares)
    .set({ views: sql`${shares.views} + 1`, lastViewedAt: now })
    .where(eq(shares.id, id))
    .run();
}

const CARD_CACHE = 64;
const cards = new Map<number, Promise<Uint8Array>>();

/** The share's card, drawn once and kept, so repeated requests cost no drawing. At most 64 kept; the oldest drawn goes first. */
export function shareCard(row: ShareRow, fetchFn?: typeof fetch): Promise<Uint8Array> {
  const hit = cards.get(row.id);
  if (hit) return hit;
  const snapshot = row.snapshot as ShareSnapshot;
  const card = snapshot.kind === "answer" ? makeAnswerCard({ ...snapshot.card, format: "wide", fetchFn }) : makeCard({ ...snapshot.card, format: "wide", fetchFn });
  card.catch(() => cards.delete(row.id));
  if (cards.size >= CARD_CACHE) cards.delete(cards.keys().next().value!);
  cards.set(row.id, card);
  return card;
}
