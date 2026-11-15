import { useQueryClient } from "@tanstack/react-query";
import { ApiError, request } from "../api/client";
import { showToast } from "../lib/toast";

export function playbackProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "no_active_device") return "No Spotify device is active. Open Spotify on a device, then try again.";
    if (error.code === "premium_required") return "Playback control needs Spotify Premium.";
    if (error.code === "spotify_not_connected") return "Spotify is not connected. Connect it in Settings, then try again.";
    if (error.code === "spotify_paused") return "Spotify calls are paused for now. Try again later.";
    return error.message;
  }
  return "Could not reach encore. Check that it is running, then try again.";
}

export const openInSpotify = (uri: string) => `https://open.spotify.com/${uri.split(":")[1]}/${uri.split(":")[2]}`;

const SETTLED_MS = 1500;

export function usePlayback() {
  const queryClient = useQueryClient();
  const send = async (path: string, body: unknown, done?: string) => {
    try {
      await request(path, { json: body });
      if (done) showToast(done);
      await queryClient.invalidateQueries({ queryKey: ["player"] });
      // Spotify reports a new song a moment after the command: ask once more when it has.
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["player"] }), SETTLED_MS);
      return true;
    } catch (error) {
      showToast(playbackProblem(error), "problem");
      return false;
    }
  };
  return {
    play: (uris: string[]) => send("/api/player/play", { uris: uris.slice(0, 100) }),
    playContext: (contextUri: string) => send("/api/player/play", { contextUri }),
    queue: (uri: string, name: string) => send("/api/player/queue", { uri }, `Added “${name}” to the queue.`),
    resume: () => send("/api/player/play", {}),
    pause: () => send("/api/player/pause", {}),
    next: () => send("/api/player/next", {}),
    shuffle: (state: boolean) => send("/api/player/shuffle", { state }),
  };
}
