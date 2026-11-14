import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { appPlaylists } from "../db/schema";
import type { SpotifyClient } from "../spotify/client";

export type AppPlaylistPurpose = "dj";

const names: Record<AppPlaylistPurpose, { name: string; description: string }> = {
  dj: { name: "encore session", description: "Played by encore. Its upcoming songs change while it plays." },
};

export class NotAppPlaylistError extends Error {
  constructor(id: string) {
    super(`Playlist ${id} is not owned by encore`);
  }
}

const chunk = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

export class AppPlaylists {
  constructor(
    private readonly db: Db,
    private readonly spotify: SpotifyClient,
    private readonly now: () => number = Date.now,
  ) {}

  ids(): string[] {
    return this.db.select({ id: appPlaylists.playlistId }).from(appPlaylists).all().map((r) => r.id);
  }

  async ensure(purpose: AppPlaylistPurpose): Promise<string> {
    const existing = this.db.select().from(appPlaylists).where(eq(appPlaylists.purpose, purpose)).get();
    if (existing) return existing.playlistId;
    const created = await this.spotify.request<{ id: string }>("POST", "/me/playlists", { ...names[purpose], public: false });
    this.db.insert(appPlaylists).values({ purpose, playlistId: created.id, createdAt: this.now() }).run();
    return created.id;
  }

  async replace(id: string, uris: string[]) {
    this.assertOwned(id);
    const [first = [], ...rest] = chunk(uris, 100);
    await this.spotify.request("PUT", `/playlists/${id}/items`, { uris: first });
    for (const batch of rest) await this.spotify.request("POST", `/playlists/${id}/items`, { uris: batch });
  }

  async append(id: string, uris: string[]) {
    this.assertOwned(id);
    for (const batch of chunk(uris, 100)) await this.spotify.request("POST", `/playlists/${id}/items`, { uris: batch });
  }

  async remove(id: string, uris: string[]) {
    this.assertOwned(id);
    for (const batch of chunk(uris, 100)) await this.spotify.request("DELETE", `/playlists/${id}/items`, { items: batch.map((uri) => ({ uri })) });
  }

  private assertOwned(id: string) {
    if (!this.ids().includes(id)) throw new NotAppPlaylistError(id);
  }
}
