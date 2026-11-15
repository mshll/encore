import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Settings } from "../settings/settings";
import { LISTEN } from "../analytics/common";
import type { Db } from "../db/client";
import { radarArtists, releases, tracks } from "../db/schema";
import { saveSpotifyTrack } from "../ingest/live/enrich";
import { localTime } from "../plays/localTime";
import type { SpotifyClient } from "../spotify/client";
import { SpotifyApiError } from "../spotify/errors";
import type { Page, SimplifiedAlbum } from "../spotify/types";

export type RadarConfig = Pick<Settings, "timezone" | "radarMinListens" | "radarArtistsPerRun" | "radarRecheckMs" | "radarBaselineDays">;
export type RadarCandidate = { artist: string; listens: number; artistId: string | null; lastCheckedAt: number | null };
export type RadarResult = { due: number; checked: number; resolved: number; unresolved: number; found: number; newReleases: number; calls: number };

const YEAR_MS = 365 * 86_400_000;
const MAX_RESOLVE_ATTEMPTS = 3;
const ALBUM_PAGE = 10;
const NEW_GRACE_DAYS = 1;

export function radarCandidates(db: Db, minListens: number, now: number): RadarCandidate[] {
  return db.all<RadarCandidate>(sql`
    with listened as (
      select t.artist, coalesce(sum(${LISTEN}), 0) as listens
      from plays p join tracks t on t.uri = p.track_uri
      where p.kind = 'track' and p.ts >= ${now - YEAR_MS}
      group by t.artist having listens >= ${minListens}
    ),
    ids as (
      select t.artist, ta.artist_id, row_number() over (partition by t.artist order by count(*) desc, ta.artist_id) as rn
      from tracks t join track_artists ta on ta.track_uri = t.uri and ta.position = 0
      where t.artist in (select artist from listened)
      group by t.artist, ta.artist_id
    )
    select l.artist, l.listens, i.artist_id as artistId, r.last_checked_at as lastCheckedAt
    from listened l left join ids i on i.artist = l.artist and i.rn = 1
    left join radar_artists r on r.artist_id = i.artist_id
    order by (r.last_checked_at is not null), r.last_checked_at, l.listens desc, l.artist`);
}

function isoDay(date: string, precision: SimplifiedAlbum["release_date_precision"]): string {
  if (precision === "year") return `${date.slice(0, 4)}-01-01`;
  if (precision === "month") return `${date.slice(0, 7)}-01`;
  return date.slice(0, 10);
}

function dayMinus(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

async function resolveArtistId(db: Db, spotify: SpotifyClient, artist: string): Promise<"resolved" | "failed" | "exhausted"> {
  const track = db.all<{ uri: string }>(sql`
    select t.uri from tracks t left join plays p on p.track_uri = t.uri
    where t.artist = ${artist} and t.enrich_attempts < ${MAX_RESOLVE_ATTEMPTS}
      and not exists (select 1 from track_artists ta where ta.track_uri = t.uri)
    group by t.uri order by count(p.id) desc, t.uri limit 1`)[0];
  if (!track) return "exhausted";
  try {
    saveSpotifyTrack(db, await spotify.track(track.uri.split(":")[2]!), track.uri);
    return "resolved";
  } catch (error) {
    if (!(error instanceof SpotifyApiError)) throw error;
    db.update(tracks).set({ enrichAttempts: sql`${tracks.enrichAttempts} + 1` }).where(eq(tracks.uri, track.uri)).run();
    return "failed";
  }
}

const OWN_GROUPS = new Set(["album", "single"]);

/** Spotify also lists albums the artist only appears on; a release counts only when the artist is credited on the album itself. */
const byArtist = (artistId: string) => (album: SimplifiedAlbum) => (album.album_group === undefined || OWN_GROUPS.has(album.album_group)) && album.artists.some((a) => a.id === artistId);

async function fetchReleases(spotify: SpotifyClient, artistId: string): Promise<{ albums: SimplifiedAlbum[]; calls: number }> {
  const path = (groups: string) => `/artists/${encodeURIComponent(artistId)}/albums?include_groups=${groups}&limit=${ALBUM_PAGE}`;
  const first = await spotify.request<Page<SimplifiedAlbum>>("GET", path("album,single"));
  if (first.total <= first.items.length) return { albums: first.items.filter(byArtist(artistId)), calls: 1 };
  const singles = await spotify.request<Page<SimplifiedAlbum>>("GET", path("single"));
  return { albums: [...new Map([...first.items, ...singles.items].map((a) => [a.id, a])).values()].filter(byArtist(artistId)), calls: 2 };
}

function storeReleases(db: Db, albums: SimplifiedAlbum[], newFrom: string, now: number): { found: number; fresh: number } {
  const known = new Set(
    albums.length
      ? db
          .select({ id: releases.id })
          .from(releases)
          .where(
            inArray(
              releases.id,
              albums.map((a) => a.id),
            ),
          )
          .all()
          .map((r) => r.id)
      : [],
  );
  let fresh = 0;
  for (const album of albums) {
    if (known.has(album.id)) continue;
    const releaseDate = isoDay(album.release_date, album.release_date_precision);
    const isNew = releaseDate >= newFrom;
    if (isNew) fresh++;
    db.insert(releases)
      .values({
        id: album.id,
        uri: album.uri,
        artistId: album.artists[0]!.id,
        artistName: album.artists[0]!.name,
        name: album.name,
        albumType: album.album_type,
        releaseDate,
        totalTracks: album.total_tracks,
        imageUrl: album.images?.[0]?.url ?? null,
        firstSeenAt: now,
        isNew,
      })
      .onConflictDoNothing()
      .run();
  }
  return { found: albums.length - known.size, fresh };
}

export async function runRadar(db: Db, spotify: SpotifyClient, config: RadarConfig, now = Date.now()): Promise<RadarResult> {
  const due = radarCandidates(db, config.radarMinListens, now).filter((c) => c.lastCheckedAt === null || c.lastCheckedAt <= now - config.radarRecheckMs);
  const result: RadarResult = { due: due.length, checked: 0, resolved: 0, unresolved: 0, found: 0, newReleases: 0, calls: 0 };
  const today = localTime(now, config.timezone).day;
  for (const candidate of due) {
    if (result.calls >= config.radarArtistsPerRun) break;
    if (!candidate.artistId) {
      const outcome = await resolveArtistId(db, spotify, candidate.artist);
      if (outcome !== "exhausted") result.calls++;
      if (outcome === "resolved") result.resolved++;
      else result.unresolved++;
      continue;
    }
    const { albums, calls } = await fetchReleases(spotify, candidate.artistId);
    result.calls += calls;
    const newFrom = candidate.lastCheckedAt === null ? dayMinus(today, config.radarBaselineDays) : dayMinus(localTime(candidate.lastCheckedAt, config.timezone).day, NEW_GRACE_DAYS);
    const stored = storeReleases(db, albums, newFrom, now);
    db.insert(radarArtists)
      .values({ artistId: candidate.artistId, lastCheckedAt: now })
      .onConflictDoUpdate({ target: radarArtists.artistId, set: { lastCheckedAt: now } })
      .run();
    result.checked++;
    result.found += stored.found;
    result.newReleases += stored.fresh;
  }
  return result;
}

export type Release = ReturnType<typeof releaseView>;

function releaseView(r: typeof releases.$inferSelect) {
  return {
    id: r.id,
    uri: r.uri,
    url: `https://open.spotify.com/album/${r.id}`,
    name: r.name,
    artist: r.artistName,
    artistId: r.artistId,
    albumType: r.albumType,
    releaseDate: r.releaseDate,
    totalTracks: r.totalTracks,
    imageUrl: r.imageUrl,
    isNew: r.isNew,
    seen: r.seenAt !== null,
    firstSeenAt: new Date(r.firstSeenAt).toISOString(),
  };
}

export function listReleases(db: Db, { status, since, limit }: { status: "new" | "recent"; since: string; limit: number }) {
  const where = status === "new" ? and(eq(releases.isNew, true), isNull(releases.seenAt)) : gte(releases.releaseDate, since);
  return db.select().from(releases).where(where).orderBy(desc(releases.releaseDate), releases.artistName).limit(limit).all().map(releaseView);
}

export function newReleasesSince(db: Db, since: number) {
  return db
    .select()
    .from(releases)
    .where(and(eq(releases.isNew, true), gte(releases.firstSeenAt, since)))
    .orderBy(desc(releases.releaseDate))
    .all()
    .map(releaseView);
}

export function markReleasesSeen(db: Db, ids: string[] | undefined, now: number): number {
  const unseen = isNull(releases.seenAt);
  return db
    .update(releases)
    .set({ seenAt: now })
    .where(ids ? and(unseen, inArray(releases.id, ids)) : and(unseen, eq(releases.isNew, true)))
    .returning({ id: releases.id })
    .all().length;
}

export function radarStatus(db: Db, config: RadarConfig, now: number) {
  const candidates = radarCandidates(db, config.radarMinListens, now);
  return {
    artists: candidates.length,
    withId: candidates.filter((c) => c.artistId).length,
    checkedRecently: candidates.filter((c) => c.lastCheckedAt !== null && c.lastCheckedAt > now - config.radarRecheckMs).length,
    unseenNew: db.select({ n: count() }).from(releases).where(and(eq(releases.isNew, true), isNull(releases.seenAt))).get()!.n,
  };
}
