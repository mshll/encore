import { z } from "zod";
import { artistKey } from "./blocks";

export const MAX_SET_ITEMS = 80;

const cap = z.number().int().min(1).max(MAX_SET_ITEMS).nullable();

export const constraintsSchema = z.strictObject({
  maxPerArtist: cap.describe("Most songs by one primary artist; null for no limit."),
  maxPerAlbum: cap.describe("Most songs from one album; null for no limit."),
  newSongs: z.number().int().min(0).max(MAX_SET_ITEMS).nullable().describe("Exactly this many songs the owner has never played; null to leave it to the request."),
  exclude: z.strictObject({
    artists: z.array(z.string().trim().min(1).max(200)).max(100),
    songs: z.array(z.strictObject({ songKey: z.string().min(1).max(400), label: z.string().trim().min(1).max(400) })).max(200),
  }),
});

export const constraintsPatch = constraintsSchema.partial();

export type Constraints = z.infer<typeof constraintsSchema>;
export type ConstraintsPatch = z.infer<typeof constraintsPatch>;
export type ConstraintDefaults = Pick<Constraints, "maxPerArtist" | "maxPerAlbum" | "newSongs">;

export const NO_CONSTRAINTS: Constraints = { maxPerArtist: null, maxPerAlbum: null, newSongs: null, exclude: { artists: [], songs: [] } };

export const withDefaults = (defaults: ConstraintDefaults, patch: ConstraintsPatch = {}): Constraints => ({ ...NO_CONSTRAINTS, ...defaults, ...patch });

/** A song as the constraints see it. `artists[0]` is the primary artist, which is what the artist cap counts. */
export type ConstrainedSong = { position: number; songKey: string; name: string; artists: string[]; album: string | null; isNew: boolean };

const albumKey = (album: string) => album.trim().toLowerCase();

/** Why the owner's exclusions rule this song out, or null. */
export function exclusion(c: Constraints, song: Pick<ConstrainedSong, "songKey" | "name" | "artists">): string | null {
  if (c.exclude.songs.some((s) => s.songKey === song.songKey)) return `the owner excluded ${song.name}`;
  const excluded = new Set(c.exclude.artists.map(artistKey));
  const artist = song.artists.find((a) => excluded.has(artistKey(a)));
  return artist ? `${song.name} is by ${artist}, whom the owner excluded` : null;
}

/** Running per-artist and per-album counts, for callers that add songs one at a time. */
export class CapTally {
  private readonly artists = new Map<string, number>();
  private readonly albums = new Map<string, number>();

  constructor(private readonly c: Constraints) {}

  fits(song: Pick<ConstrainedSong, "artists" | "album">): boolean {
    const artist = song.artists[0];
    if (this.c.maxPerArtist !== null && artist !== undefined && (this.artists.get(artistKey(artist)) ?? 0) >= this.c.maxPerArtist) return false;
    if (this.c.maxPerAlbum !== null && song.album && (this.albums.get(albumKey(song.album)) ?? 0) >= this.c.maxPerAlbum) return false;
    return true;
  }

  add(song: Pick<ConstrainedSong, "artists" | "album">) {
    const artist = song.artists[0];
    if (artist !== undefined) this.artists.set(artistKey(artist), (this.artists.get(artistKey(artist)) ?? 0) + 1);
    if (song.album) this.albums.set(albumKey(song.album), (this.albums.get(albumKey(song.album)) ?? 0) + 1);
  }
}

function overCap(songs: ConstrainedSong[], max: number | null, key: (s: ConstrainedSong) => string | null, describe: (s: ConstrainedSong) => string, per: string, noun: string): string[] {
  if (max === null) return [];
  const groups = new Map<string, ConstrainedSong[]>();
  for (const s of songs) {
    const k = key(s);
    if (k !== null) groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  return [...groups.values()]
    .filter((g) => g.length > max)
    .map((g) => `${describe(g[0]!)} has ${g.length} ${noun}s (${noun}s ${g.map((s) => s.position).join(", ")}); the owner allows at most ${max} per ${per}. Replace ${g.length - max} of them.`);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Every way `songs` breaks `c`, as errors Claude can act on. `noun` names one item in the messages ("track", "pick"). */
export function constraintErrors(songs: ConstrainedSong[], c: Constraints, noun = "track"): string[] {
  const label = noun[0]!.toUpperCase() + noun.slice(1);
  const errors = songs.flatMap((s) => {
    const why = exclusion(c, s);
    return why ? [`${label} ${s.position}: ${why}. Replace it.`] : [];
  });
  errors.push(
    ...overCap(songs, c.maxPerArtist, (s) => (s.artists[0] ? artistKey(s.artists[0]) : null), (s) => s.artists[0]!, "artist", noun),
    ...overCap(songs, c.maxPerAlbum, (s) => (s.album ? albumKey(s.album) : null), (s) => `The album ${s.album}`, "album", noun),
  );
  if (c.newSongs !== null) {
    const fresh = songs.filter((s) => s.isNew).length;
    if (fresh < c.newSongs) errors.push(`The owner asked for exactly ${plural(c.newSongs, "new song")}; this has ${fresh}. Add ${plural(c.newSongs - fresh, "verified song")} the owner has never played.`);
    if (fresh > c.newSongs) errors.push(`The owner asked for exactly ${plural(c.newSongs, "new song")}; this has ${fresh}. Replace ${fresh - c.newSongs} of them with songs from the owner's history.`);
  }
  return errors;
}

/** The constraints in plain words, for a prompt. */
export function describeConstraints(c: Constraints): string {
  const lines = [
    c.maxPerArtist !== null && `At most ${plural(c.maxPerArtist, "song")} per artist, counted by primary artist.`,
    c.maxPerAlbum !== null && `At most ${plural(c.maxPerAlbum, "song")} per album.`,
    c.newSongs !== null && `Exactly ${plural(c.newSongs, "new song")} the owner has never played; every other song comes from their history.`,
    c.exclude.artists.length > 0 && `No songs by: ${c.exclude.artists.join(", ")}.`,
    c.exclude.songs.length > 0 && `Leave out these songs: ${c.exclude.songs.map((s) => `${s.label} (songKey ${s.songKey})`).join("; ")}.`,
  ].filter((l): l is string => typeof l === "string");
  return lines.length ? lines.join("\n") : "None.";
}
