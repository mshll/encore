import { desc, eq } from "drizzle-orm";
import { isSkip, playOutcome } from "../analytics/common";
import type { Db } from "../db/client";
import { djSessions } from "../db/schema";
import type { WatchEvent } from "../ingest/live/watcher";
import type { PlayerApi } from "../player/api";
import type { AppPlaylists } from "./playlists";
import type { Replanner } from "./replan";

export type DjSession = typeof djSessions.$inferSelect;

export class InvalidSetError extends Error {}

export const MAX_SET_SIZE = 500;

const TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/;

export class DjService {
  private replanning: Promise<void> | null = null;
  private replanDue = false;

  constructor(
    private readonly db: Db,
    private readonly player: PlayerApi,
    private readonly playlists: AppPlaylists,
    private replanner: Replanner,
    private readonly skipTrigger: () => number,
    private readonly now: () => number = Date.now,
  ) {}

  setReplanner(replanner: Replanner) {
    this.replanner = replanner;
  }

  active(): DjSession | undefined {
    return this.db.select().from(djSessions).where(eq(djSessions.status, "active")).get();
  }

  latest(): DjSession | undefined {
    return this.db.select().from(djSessions).orderBy(desc(djSessions.id)).limit(1).get();
  }

  async start(input: string[], deviceId?: string): Promise<DjSession> {
    const uris = [...new Set(input)];
    if (uris.length === 0 || uris.length > MAX_SET_SIZE) throw new InvalidSetError(`A set needs 1 to ${MAX_SET_SIZE} songs`);
    const invalid = uris.filter((u) => !TRACK_URI.test(u));
    if (invalid.length) throw new InvalidSetError(`Not Spotify track URIs: ${invalid.slice(0, 5).join(", ")}`);
    const playlistId = await this.playlists.ensure("dj");
    await this.playlists.replace(playlistId, uris);
    await this.player.play({ contextUri: `spotify:playlist:${playlistId}`, offset: { position: 0 }, deviceId });
    await this.player.shuffle(false, deviceId);
    const now = this.now();
    this.end("stopped", "replaced");
    return this.db
      .insert(djSessions)
      .values({ playlistId, status: "active", uris, position: 0, outcomes: [], skipStreak: 0, replans: 0, startedAt: now, updatedAt: now })
      .returning()
      .get();
  }

  stop(): DjSession | undefined {
    return this.end("stopped", "stopped");
  }

  onWatchEvent(event: WatchEvent) {
    const session = this.active();
    if (!session) return;
    const contextUri = `spotify:playlist:${session.playlistId}`;
    if (event.type === "finished") {
      const { play } = event;
      const outcome = playOutcome(play);
      if (play.contextUri !== contextUri || (outcome !== "through" && !isSkip(outcome)) || !session.uris.includes(play.trackUri)) return;
      const skipped = isSkip(outcome);
      const skipStreak = skipped ? session.skipStreak + 1 : 0;
      if (skipStreak >= this.skipTrigger()) this.replanDue = true;
      this.update(session.id, {
        outcomes: [...session.outcomes, { uri: play.trackUri, outcome: skipped ? "skipped" : "finished" }],
        skipStreak,
      });
      return;
    }
    const { observation } = event;
    if (observation.contextUri && observation.contextUri !== contextUri) {
      this.replanDue = false;
      this.end("ended", "left_playlist");
      return;
    }
    const position = session.uris.indexOf(observation.trackUri);
    if (position >= 0) this.update(session.id, { position });
    if (this.replanDue && position >= 0) {
      this.replanDue = false;
      this.replanning ??= this.replan(session.id).finally(() => {
        this.replanning = null;
      });
    }
  }

  whenIdle(): Promise<void> {
    return this.replanning ?? Promise.resolve();
  }

  private async replan(id: number) {
    const session = this.db.select().from(djSessions).where(eq(djSessions.id, id)).get();
    if (!session || session.status !== "active") return;
    try {
      const proposed = await this.replanner({
        finished: session.outcomes.filter((o) => o.outcome === "finished").map((o) => o.uri),
        skipped: session.outcomes.filter((o) => o.outcome === "skipped").map((o) => o.uri),
        current: session.uris[session.position] ?? null,
        upcoming: session.uris.slice(session.position + 1),
        exclude: session.uris.slice(0, session.position + 1),
        now: this.now(),
      });
      // Playback may have moved on while the re-planner ran (an LLM call takes seconds): the track that is
      // current now must stay, so the tail is cut at the position read after the re-plan, not before it.
      const fresh = this.db.select().from(djSessions).where(eq(djSessions.id, id)).get();
      if (!fresh || fresh.status !== "active") return;
      const played = fresh.uris.slice(0, fresh.position + 1);
      const tail = fresh.uris.slice(fresh.position + 1);
      const playedSet = new Set(played);
      const next = [...new Set(proposed)].filter((u) => TRACK_URI.test(u) && !playedSet.has(u)).slice(0, MAX_SET_SIZE - played.length);
      await this.playlists.remove(session.playlistId, tail);
      this.update(id, { uris: played });
      await this.playlists.append(session.playlistId, next);
      this.update(id, { uris: [...played, ...next], replans: fresh.replans + 1, replannedAt: this.now(), replanSkips: fresh.skipStreak, skipStreak: 0 });
    } catch (error) {
      console.error(`[dj] re-plan failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private update(id: number, patch: Partial<DjSession>) {
    this.db
      .update(djSessions)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(djSessions.id, id))
      .run();
  }

  private end(status: "stopped" | "ended", reason: string): DjSession | undefined {
    const session = this.active();
    if (!session) return undefined;
    const now = this.now();
    return this.db.update(djSessions).set({ status, endReason: reason, endedAt: now, updatedAt: now }).where(eq(djSessions.id, session.id)).returning().get();
  }
}
