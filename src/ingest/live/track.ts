import type { TrackInput } from "../../plays/store";
import type { SpotifyTrack } from "../../spotify/types";

export function trackFromSpotify(track: SpotifyTrack): TrackInput {
  return {
    uri: track.uri,
    name: track.name,
    artist: track.artists[0]?.name ?? "Unknown artist",
    album: track.album.name,
    durationMs: track.duration_ms,
    releaseDate: track.album.release_date ?? null,
    albumArtUrl: track.album.images?.[0]?.url ?? null,
    complete: true,
  };
}
