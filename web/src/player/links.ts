import { useTrackByUri } from "../api/queries";
import { artistPath, songPath } from "../app/paths";

/** Pages for the playing track, once encore has matched its URI to a song it knows. Null for a song never played before. */
export function useTrackLinks(uri: string | undefined): { song: string; artist: string } | null {
  const q = useTrackByUri(uri);
  return q.data ? { song: songPath(q.data.songKey), artist: artistPath(q.data.artist) } : null;
}
