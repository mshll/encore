import { request, withQuery } from "../api/client";

/** Starts the Spotify sign-in: the server returns the authorize URL and the browser leaves for it. Spotify sends it back to `from`. */
export async function connectSpotify(from: "setup" | "settings"): Promise<void> {
  const { url } = await request<{ url: string }>(withQuery("/api/spotify/authorize", { return: from }));
  window.location.assign(url);
}
