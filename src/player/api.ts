import type { SpotifyClient } from "../spotify/client";
import { SpotifyApiError } from "../spotify/errors";
import type { PlaybackQueue, PlaybackState, SpotifyDevice, SpotifyTrack } from "../spotify/types";

export class NoActiveDeviceError extends Error {
  constructor() {
    super("No active Spotify device");
  }
}

export class PremiumRequiredError extends Error {
  constructor() {
    super("Spotify Premium is required for playback control");
  }
}

export type PlayRequest = { contextUri?: string; uris?: string[]; offset?: { position: number } | { uri: string }; deviceId?: string };

const withDevice = (path: string, deviceId?: string) => (deviceId ? `${path}${path.includes("?") ? "&" : "?"}device_id=${encodeURIComponent(deviceId)}` : path);

function playerError(error: unknown): unknown {
  if (!(error instanceof SpotifyApiError)) return error;
  if (error.reason === "NO_ACTIVE_DEVICE" || (error.status === 404 && /no active device/i.test(error.message))) return new NoActiveDeviceError();
  if (error.reason === "PREMIUM_REQUIRED") return new PremiumRequiredError();
  return error;
}

export class PlayerApi {
  constructor(private readonly spotify: SpotifyClient) {}

  state(): Promise<PlaybackState | null> {
    return this.spotify.request<PlaybackState | null>("GET", "/me/player");
  }

  async devices(): Promise<SpotifyDevice[]> {
    return (await this.spotify.request<{ devices: SpotifyDevice[] }>("GET", "/me/player/devices")).devices;
  }

  async queue(): Promise<PlaybackQueue> {
    return (await this.spotify.request<PlaybackQueue | null>("GET", "/me/player/queue")) ?? { currently_playing: null, queue: [] };
  }

  async searchTrack(query: string): Promise<SpotifyTrack | null> {
    const res = await this.spotify.request<{ tracks: { items: SpotifyTrack[] } }>("GET", `/search?type=track&limit=1&q=${encodeURIComponent(query)}`);
    return res.tracks.items[0] ?? null;
  }

  play(request: PlayRequest) {
    const body = {
      ...(request.contextUri ? { context_uri: request.contextUri } : {}),
      ...(request.uris ? { uris: request.uris } : {}),
      ...(request.offset ? { offset: request.offset } : {}),
    };
    return this.write("PUT", withDevice("/me/player/play", request.deviceId), body);
  }

  pause(deviceId?: string) {
    return this.write("PUT", withDevice("/me/player/pause", deviceId));
  }

  next(deviceId?: string) {
    return this.write("POST", withDevice("/me/player/next", deviceId));
  }

  addToQueue(uri: string, deviceId?: string) {
    return this.write("POST", withDevice(`/me/player/queue?uri=${encodeURIComponent(uri)}`, deviceId));
  }

  shuffle(state: boolean, deviceId?: string) {
    return this.write("PUT", withDevice(`/me/player/shuffle?state=${state}`, deviceId));
  }

  transfer(deviceId: string, play = false) {
    return this.write("PUT", "/me/player", { device_ids: [deviceId], play });
  }

  private async write(method: "PUT" | "POST", path: string, body?: unknown): Promise<void> {
    try {
      await this.spotify.request<unknown>(method, path, body);
    } catch (error) {
      throw playerError(error);
    }
  }
}
