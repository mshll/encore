import { eq, sql } from "drizzle-orm";
import { LISTEN } from "../../analytics/common";
import type { Db, DbOrTx } from "../../db/client";
import { artists, tracks } from "../../db/schema";
import { linkArtists, upsertTracks } from "../../plays/store";
import type { SpotifyClient } from "../../spotify/client";
import { SpotifyApiError } from "../../spotify/errors";
import type { SpotifyTrack } from "../../spotify/types";
import { trackFromSpotify } from "./track";

export const MAX_ENRICH_ATTEMPTS = 3;

export type EnrichResult = { tracks: number; artists: number; failed: number };
export type ArtResult = { attempted: number; found: number; failed: number };

const LISTENS = sql`coalesce(sum(${LISTEN}), 0)`;

type Pending = { id: string; listens: number };

export function enrichmentProgress(db: Db) {
  const t = db.all<{ total: number; enriched: number; failed: number; with_art: number }>(sql`
    select count(*) as total, count(enriched_at) as enriched, count(album_art_url) as with_art,
      coalesce(sum(enriched_at is null and enrich_attempts >= ${MAX_ENRICH_ATTEMPTS}), 0) as failed
    from tracks`)[0]!;
  const a = db.all<{ total: number; fetched: number; with_image: number }>(sql`
    select count(*) as total, count(fetched_at) as fetched, count(image_url) as with_image from artists`)[0]!;
  return {
    total: t.total,
    enriched: t.enriched,
    failed: t.failed,
    withArt: t.with_art,
    artists: { total: a.total, fetched: a.fetched, withImage: a.with_image },
  };
}

function nextTrack(db: Db): Pending | undefined {
  return db.all<Pending>(sql`
    select t.uri as id, ${LISTENS} as listens from tracks t left join plays p on p.track_uri = t.uri
    where t.enriched_at is null and t.enrich_attempts < ${MAX_ENRICH_ATTEMPTS}
    group by t.uri order by t.enrich_attempts, listens desc, t.uri limit 1`)[0];
}

function nextArtist(db: Db): Pending | undefined {
  return db.all<Pending>(sql`
    select a.id, ${LISTENS} as listens from artists a
    join track_artists ta on ta.artist_id = a.id left join plays p on p.track_uri = ta.track_uri
    where a.fetched_at is null and a.fetch_attempts < ${MAX_ENRICH_ATTEMPTS}
    group by a.id order by a.fetch_attempts, listens desc, a.id limit 1`)[0];
}

export function saveSpotifyTrack(db: DbOrTx, track: SpotifyTrack, uri = track.uri) {
  db.transaction((tx) => {
    const input = { ...trackFromSpotify(track), uri };
    upsertTracks(tx, [input]);
    if (input.albumArtUrl) tx.update(tracks).set({ albumArtUrl: input.albumArtUrl }).where(eq(tracks.uri, uri)).run();
    linkArtists(tx, uri, track.artists.filter((a) => a.id));
  });
}

async function enrichTrack(db: Db, spotify: SpotifyClient, uri: string) {
  try {
    saveSpotifyTrack(db, await spotify.track(uri.split(":")[2]!), uri);
    return true;
  } catch (error) {
    if (!(error instanceof SpotifyApiError)) throw error;
    db.update(tracks).set({ enrichAttempts: sql`${tracks.enrichAttempts} + 1` }).where(eq(tracks.uri, uri)).run();
    return false;
  }
}

async function enrichArtist(db: Db, spotify: SpotifyClient, id: string, now: number) {
  try {
    const artist = await spotify.artist(id);
    db.update(artists)
      .set({ name: artist.name, imageUrl: artist.images?.[0]?.url ?? null, fetchedAt: now })
      .where(eq(artists.id, id))
      .run();
    return true;
  } catch (error) {
    if (!(error instanceof SpotifyApiError)) throw error;
    db.update(artists).set({ fetchAttempts: sql`${artists.fetchAttempts} + 1` }).where(eq(artists.id, id)).run();
    return false;
  }
}

export async function enrich(db: Db, spotify: SpotifyClient, batchSize: number, now = Date.now): Promise<EnrichResult> {
  const result: EnrichResult = { tracks: 0, artists: 0, failed: 0 };
  for (let i = 0; i < batchSize; i++) {
    const track = nextTrack(db);
    const artist = nextArtist(db);
    if (!track && !artist) break;
    if (artist && (!track || artist.listens >= track.listens)) {
      result.artists++;
      if (!(await enrichArtist(db, spotify, artist.id, now()))) result.failed++;
    } else {
      result.tracks++;
      if (!(await enrichTrack(db, spotify, track!.id))) result.failed++;
    }
  }
  return result;
}

export async function fetchAlbumArt(db: Db, spotify: SpotifyClient, batchSize: number): Promise<ArtResult> {
  const pending = db.all<Pending>(sql`
    select t.uri as id, ${LISTENS} as listens from tracks t left join plays p on p.track_uri = t.uri
    where t.album_art_url is null and t.art_attempts < ${MAX_ENRICH_ATTEMPTS}
    group by t.uri order by t.art_attempts, listens desc, t.uri limit ${batchSize}`);
  const result: ArtResult = { attempted: 0, found: 0, failed: 0 };
  for (const { id: uri } of pending) {
    result.attempted++;
    const url = await spotify.trackThumbnail(uri.split(":")[2]!).catch((error: unknown) => {
      if (error instanceof SpotifyApiError) return null;
      throw error;
    });
    if (url) {
      db.update(tracks).set({ albumArtUrl: url }).where(eq(tracks.uri, uri)).run();
      result.found++;
    } else {
      db.update(tracks).set({ artAttempts: sql`${tracks.artAttempts} + 1` }).where(eq(tracks.uri, uri)).run();
      result.failed++;
    }
  }
  return result;
}
