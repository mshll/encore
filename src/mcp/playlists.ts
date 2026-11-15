import type { SpotifyClient } from "../spotify/client";

const ADD_BATCH = 100;
const ITEMS_PAGE = 50;
const SPOTIFY_ID = "[A-Za-z0-9]{22}";

/** The playlist was made, but its tracks could not all be added. */
export class PlaylistTracksError extends Error {
  constructor(
    readonly playlist: { id: string; url: string },
    cause: unknown,
  ) {
    super(`Created playlist ${playlist.url} (id ${playlist.id}), but adding its tracks failed`, { cause });
  }
}

export type TrackRef = string | { uri?: string | null };

function spotifyId(kind: "track" | "playlist", ref: string): string | null {
  const text = ref.trim();
  const match = text.match(new RegExp(`^(?:spotify:${kind}:)?(${SPOTIFY_ID})$`)) ?? text.match(new RegExp(`^https://open\\.spotify\\.com/(?:intl-[a-z-]+/)?${kind}/(${SPOTIFY_ID})(?:[/?#].*)?$`));
  return match?.[1] ?? null;
}

export const playlistIdOf = (ref: string): string | null => spotifyId("playlist", ref);

/** Track URIs in order, once each. Accepts ids, URIs, open.spotify.com links and objects with a `uri`, such as the songs `forgotten` or `top` return. */
export function trackUris(refs: TrackRef[]): { uris: string[]; invalid: string[] } {
  const uris = new Set<string>();
  const invalid: string[] = [];
  for (const ref of refs) {
    const text = typeof ref === "string" ? ref : (ref.uri ?? "");
    const id = spotifyId("track", text);
    if (id) uris.add(`spotify:track:${id}`);
    else invalid.push(text || JSON.stringify(ref));
  }
  return { uris: [...uris], invalid };
}

async function playlistUris(spotify: SpotifyClient, playlistId: string): Promise<Set<string>> {
  const uris = new Set<string>();
  for (let offset = 0; ; offset += ITEMS_PAGE) {
    const page = await spotify.playlistItems(playlistId, offset, ITEMS_PAGE);
    for (const entry of page.items) {
      const uri = (entry.item ?? entry.track)?.uri;
      if (uri) uris.add(uri);
    }
    if (!page.next || page.items.length === 0) return uris;
  }
}

async function append(spotify: SpotifyClient, playlistId: string, uris: string[]) {
  for (let i = 0; i < uris.length; i += ADD_BATCH) await spotify.addPlaylistItems(playlistId, uris.slice(i, i + ADD_BATCH));
}

/** Appends the tracks the playlist does not hold yet. */
export async function addToPlaylist(spotify: SpotifyClient, playlistId: string, uris: string[]) {
  const existing = uris.length ? await playlistUris(spotify, playlistId) : new Set<string>();
  const fresh = uris.filter((uri) => !existing.has(uri));
  await append(spotify, playlistId, fresh);
  return { added: fresh.length, alreadyInPlaylist: uris.length - fresh.length };
}

export async function createPlaylist(spotify: SpotifyClient, input: { name: string; description: string; public: boolean; uris: string[] }) {
  const playlist = await spotify.createPlaylist({ name: input.name, description: input.description, public: input.public });
  const created = { id: playlist.id, url: playlist.external_urls.spotify };
  try {
    await append(spotify, playlist.id, input.uris);
  } catch (error) {
    throw new PlaylistTracksError(created, error);
  }
  return { ...created, added: input.uris.length };
}
