export class SpotifyNotConnectedError extends Error {
  constructor() {
    super("Spotify is not connected");
  }
}

export class SpotifyAuthError extends Error {}

export class SpotifyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(`Spotify API ${status}: ${message}`);
  }
}

export type BlockReason = "rate_limited" | "quota_exceeded";

export class SpotifyBlockedError extends Error {
  constructor(
    readonly reason: BlockReason,
    readonly blockedUntil: number,
  ) {
    super(`Spotify calls paused (${reason}) until ${new Date(blockedUntil).toISOString()}`);
  }
}
