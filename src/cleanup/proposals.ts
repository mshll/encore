import { and, count, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { musicWhere, rate, songStatsSql, type SongRow } from "../analytics/common";
import { momentSplit } from "../analytics/skips";
import type { Db } from "../db/client";
import { CLEANUP_KINDS, cleanupProposals, type CleanupKind } from "../db/schema";

export const CLEANUP_RULES = {
  savedGraceDays: 30,
  playlistSkipMinPlays: 8,
  playlistSkipRateAtLeast: 0.9,
  dislikeMinPlays: 8,
  dislikeMinContextPlays: 5,
};

export type Proposal = { key: string; kind: CleanupKind; playlistId: string | null; uri: string; evidence: Record<string, unknown> };

type SongMeta = { uri: string; song_key: string; name: string; artist: string; album_art_url: string | null };

const iso = (ts: number | null | undefined) => (ts == null ? null : new Date(ts).toISOString());

function songStats(db: Db): Map<string, SongRow> {
  return new Map(db.all<SongRow>(songStatsSql(musicWhere({}))).map((r) => [r.song_key, r]));
}

function evidenceFor(meta: SongMeta, stats: SongRow | undefined) {
  return {
    name: meta.name,
    artist: meta.artist,
    albumArtUrl: meta.album_art_url,
    songKey: meta.song_key,
    plays: stats?.plays ?? 0,
    listens: stats?.listens ?? 0,
    skips: stats?.skips ?? 0,
    skipRate: stats ? rate(stats.skips, stats.skip_known) : null,
    lastPlayed: iso(stats?.last_ts),
  };
}

export function computeProposals(db: Db, now: number): Proposal[] {
  const stats = songStats(db);
  const dislikes = new Set(
    momentSplit(db, { range: {}, minPlays: CLEANUP_RULES.dislikeMinPlays, minContextPlays: CLEANUP_RULES.dislikeMinContextPlays, limit: 1_000_000, only: "dislike" }).songs.map(
      (s) => s.songKey,
    ),
  );
  const proposals: Proposal[] = [];

  const saved = db.all<SongMeta & { added_at: number }>(sql`
    select s.uri, s.added_at, t.song_key, t.name, t.artist, t.album_art_url from saved_tracks s join tracks t on t.uri = s.uri`);
  const graceCutoff = now - CLEANUP_RULES.savedGraceDays * 86_400_000;
  for (const s of saved) {
    const st = stats.get(s.song_key);
    const evidence = { ...evidenceFor(s, st), savedAt: iso(s.added_at) };
    if (!st && s.added_at < graceCutoff) proposals.push({ key: `saved_never_played:${s.uri}`, kind: "saved_never_played", playlistId: null, uri: s.uri, evidence });
    if (dislikes.has(s.song_key)) proposals.push({ key: `saved_dislike:${s.uri}`, kind: "saved_dislike", playlistId: null, uri: s.uri, evidence: { ...evidence, class: "dislike" } });
  }

  const items = db.all<SongMeta & { playlist_id: string; playlist_name: string; position: number }>(sql`
    select i.playlist_id, op.name as playlist_name, i.position, i.uri, t.song_key, t.name, t.artist, t.album_art_url
    from playlist_items i join owned_playlists op on op.id = i.playlist_id join tracks t on t.uri = i.uri
    order by i.playlist_id, i.position`);
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = `${item.playlist_id}|${item.song_key}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const group of groups.values()) {
    const first = group[0]!;
    const st = stats.get(first.song_key);
    const playlist = { playlistId: first.playlist_id, playlistName: first.playlist_name };
    if (st && st.skip_known >= CLEANUP_RULES.playlistSkipMinPlays && st.skips / st.skip_known >= CLEANUP_RULES.playlistSkipRateAtLeast) {
      proposals.push({
        key: `playlist_skipped:${first.playlist_id}:${first.song_key}`,
        kind: "playlist_skipped",
        playlistId: first.playlist_id,
        uri: first.uri,
        evidence: { ...evidenceFor(first, st), ...playlist, positions: group.map((g) => g.position), uris: [...new Set(group.map((g) => g.uri))] },
      });
    }
    if (group.length > 1) {
      proposals.push({
        key: `playlist_duplicate:${first.playlist_id}:${first.song_key}`,
        kind: "playlist_duplicate",
        playlistId: first.playlist_id,
        uri: first.uri,
        evidence: {
          ...evidenceFor(first, st),
          ...playlist,
          keep: { position: first.position, uri: first.uri },
          duplicates: group.slice(1).map((g) => ({ position: g.position, uri: g.uri })),
        },
      });
    }
  }
  return proposals;
}

export function refreshProposals(db: Db, now: number) {
  const proposals = computeProposals(db, now);
  db.transaction((tx) => {
    for (const p of proposals) {
      tx.insert(cleanupProposals)
        .values({ ...p, status: "open", createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: cleanupProposals.key,
          set: { uri: p.uri, evidence: p.evidence, updatedAt: now },
          setWhere: eq(cleanupProposals.status, "open"),
        })
        .run();
    }
    const keys = proposals.map((p) => p.key);
    tx.delete(cleanupProposals)
      .where(and(eq(cleanupProposals.status, "open"), keys.length ? notInArray(cleanupProposals.key, keys) : undefined))
      .run();
  });
  return proposalCounts(db);
}

export function proposalCounts(db: Db): Record<CleanupKind, number> {
  const rows = db.all<{ kind: CleanupKind; n: number }>(sql`select kind, count(*) as n from cleanup_proposals where status = 'open' group by kind`);
  return Object.fromEntries(CLEANUP_KINDS.map((k) => [k, rows.find((r) => r.kind === k)?.n ?? 0])) as Record<CleanupKind, number>;
}

export function listProposals(db: Db, { kind, status, limit, offset }: { kind?: CleanupKind; status: "open" | "dismissed" | "applied"; limit: number; offset: number }) {
  const where = and(eq(cleanupProposals.status, status), kind ? eq(cleanupProposals.kind, kind) : undefined);
  const rows = db.select().from(cleanupProposals).where(where).orderBy(cleanupProposals.kind, desc(cleanupProposals.id)).limit(limit).offset(offset).all();
  return {
    total: db.select({ n: count() }).from(cleanupProposals).where(where).get()!.n,
    items: rows.map((r) => ({ id: r.id, kind: r.kind, playlistId: r.playlistId, uri: r.uri, status: r.status, evidence: r.evidence, updatedAt: iso(r.updatedAt) })),
  };
}

export function dismissProposals(db: Db, ids: number[], now: number): number {
  return db
    .update(cleanupProposals)
    .set({ status: "dismissed", updatedAt: now })
    .where(and(inArray(cleanupProposals.id, ids), eq(cleanupProposals.status, "open")))
    .returning({ id: cleanupProposals.id })
    .all().length;
}
