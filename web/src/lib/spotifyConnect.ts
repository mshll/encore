import { request } from "../api/client";

/** Starts the Spotify sign-in: the server returns the authorize URL and the browser leaves for it. */
export async function connectSpotify(): Promise<void> {
  const { url } = await request<{ url: string }>("/api/spotify/authorize");
  window.location.assign(url);
}
