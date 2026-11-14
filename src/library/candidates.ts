import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { spotifyLookups } from "../db/schema";
import { normalizeTitle, songKey } from "../plays/song";
import type { SpotifyClient } from "../spotify/client";
import type { SpotifyTrack } from "../spotify/types";
import { isBlocked, type Blocked } from "./blocks";

const LOOKUP_TTL_MS = 30 * 86_400_000;
const SEARCH_LIMIT = 10;
const MIN_SPACING_MS = 400;
const VARIANT = /\b(live|remix|mix|karaoke|instrumental|acoustic|sped up|slowed|reverb|cover|tribute|demo|edit|version|rehearsal|8d)\b/i;

export type VerifiedSong = {
  uri: string;
  songKey: string;
  name: string;
  artists: string[];
  album: string;
  releaseDate: string | null;
  durationMs: number;
  heard: boolean;
  plays: number;
};

export type Verification = { ok: true; song: VerifiedSong } | { ok: false; reason: string; closest?: { name: string; artists: string[]; album: string }[] };

const fold = (s: string) => normalizeTitle(s);

export class CandidateVerifier {
  private lastSearchAt = 0;
  private searches = 0;
  readonly verified = new Map<string, VerifiedSong>();

  constructor(
    private readonly db: Db,
    private readonly spotify: SpotifyClient,
    private readonly blocked: Blocked,
    private readonly maxSearches: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
  ) {}

  async verify(title: string, artist: string, allowVariant: boolean): Promise<Verification> {
    const tracks = await this.search(title, artist);
    const wantTitle = fold(title);
    const wantArtist = fold(artist);
    const variantOk = allowVariant || VARIANT.test(title);
    const matches = tracks.filter(
      (t) =>
        fold(t.name) === wantTitle &&
        t.artists.some((a) => fold(a.name) === wantArtist) &&
        (variantOk || (!VARIANT.test(t.name) && !VARIANT.test(t.album.name))),
    );
    const match = matches[0];
    if (!match) {
      return {
        ok: false,
        reason: tracks.length ? "No exact title and artist match on Spotify (variants such as live, remix or karaoke are rejected unless asked for)" : "Not found on Spotify",
        closest: tracks.slice(0, 3).map((t) => ({ name: t.name, artists: t.artists.map((a) => a.name), album: t.album.name })),
      };
    }
    const artists = match.artists.map((a) => a.name);
    const key = songKey(match.name, artists[0]!);
    if (isBlocked(this.blocked, key, artists)) return { ok: false, reason: "The owner blocked this song or artist" };
    const plays = heardPlays(this.db, [key, songKey(match.name, artist)], match.uri);
    const song: VerifiedSong = {
      uri: match.uri,
      songKey: key,
      name: match.name,
      artists,
      album: match.album.name,
      releaseDate: match.album.release_date ?? null,
      durationMs: match.duration_ms,
      heard: plays > 0,
      plays,
    };
    this.verified.set(song.uri, song);
    return { ok: true, song };
  }

  private async search(title: string, artist: string): Promise<SpotifyTrack[]> {
    const query = `track:${title.replace(/"/g, "")} artist:${artist.replace(/"/g, "")}`;
    const cacheKey = `search:${query.toLowerCase()}`;
    const hit = this.db.select().from(spotifyLookups).where(eq(spotifyLookups.query, cacheKey)).get();
    if (hit && hit.fetchedAt > this.now() - LOOKUP_TTL_MS) return hit.result as SpotifyTrack[];
    if (this.searches >= this.maxSearches) throw new SearchLimitError(this.maxSearches);
    const wait = this.lastSearchAt + MIN_SPACING_MS - this.now();
    if (wait > 0) await this.sleep(wait);
    this.searches++;
    this.lastSearchAt = this.now();
    const items = (await this.spotify.searchTracks(query, SEARCH_LIMIT)).tracks.items.filter(Boolean);
    const result = items.map((t) => ({ id: t.id, uri: t.uri, name: t.name, duration_ms: t.duration_ms, artists: t.artists, album: t.album }));
    this.db
      .insert(spotifyLookups)
      .values({ query: cacheKey, result, fetchedAt: this.now() })
      .onConflictDoUpdate({ target: spotifyLookups.query, set: { result, fetchedAt: this.now() } })
      .run();
    return result;
  }
}

export class SearchLimitError extends Error {
  constructor(limit: number) {
    super(`Spotify search limit for this run reached (${limit}); finish with the songs already verified`);
  }
}

export function heardPlays(db: Db, songKeys: string[], uri: string): number {
  const keys = sql.join(
    songKeys.map((k) => sql`${k}`),
    sql`, `,
  );
  return (
    db.all<{ n: number }>(sql`
      select count(*) as n from plays p join tracks t on t.uri = p.track_uri
      where p.kind = 'track' and (t.song_key in (${keys}) or p.track_uri = ${uri})`)[0]?.n ?? 0
  );
}
