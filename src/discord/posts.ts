import { latestDigest } from "../assistant/api";
import { humanDatesIn, RECAP_KINDS } from "../digest/periods";
import type { DigestKind } from "../digest/service";
import { getJobState, setJobState } from "../jobs/state";
import { weekOf, weekPicks } from "../picks/service";
import { newReleasesSince } from "../radar/radar";
import { picksMessage } from "./commands/assistant";
import { postToChannel, type Discord } from "./index";
import type { DiscordContext } from "./registry";
import { plain, type Embed, type Message } from "./types";

const STATE = "discord_posts";
const DAY_MS = 86_400_000;
const FRESH_FOR_MS: Record<DigestKind, number> = { weekly: 8 * DAY_MS, monthly: 32 * DAY_MS, yearly: 32 * DAY_MS };
const RELEASES_SHOWN = 10;

type PostState = { picks?: string; weekly?: string; monthly?: string; yearly?: string };

export function digestMessage(ctx: DiscordContext, kind: DigestKind): { key: string; message: Message } | null {
  const digest = latestDigest(ctx.db, kind);
  if (!digest || digest.inProgress || Date.parse(digest.createdAt) < ctx.now() - FRESH_FOR_MS[kind]) return null;
  const embeds: Embed[] = [];
  if (kind === "weekly") {
    const releases = newReleasesSince(ctx.db, Date.parse(`${digest.from}T00:00:00Z`)).slice(0, RELEASES_SHOWN);
    if (releases.length)
      embeds.push({
        title: "New releases from artists you play",
        description: releases.map((r) => `[${plain(r.name, 100)}](${r.url}) by ${plain(r.artist, 100)}, ${r.albumType} ${humanDatesIn(r.releaseDate)}`).join("\n"),
        ...(releases[0]!.imageUrl ? { thumbnail: { url: releases[0]!.imageUrl } } : {}),
      });
  }
  return { key: digest.periodKey, message: { content: plain(digest.rendered, 1900), embeds } };
}

/**
 * Posts this week's picks, the newest weekly digest (with new releases) and the newest monthly recap to the
 * channel, each once per period. Safe to call every hour: what was posted is remembered per kind.
 */
export async function publishAssistantPosts(discord: Discord, ctx: DiscordContext): Promise<{ posted: string[] }> {
  const state = (getJobState(ctx.db, STATE)?.data ?? {}) as PostState;
  const posted: string[] = [];
  const mark = (patch: PostState) => {
    Object.assign(state, patch);
    setJobState(ctx.db, STATE, { lastSuccessAt: ctx.now(), data: state });
  };
  const week = weekOf(ctx.now(), ctx.settings.get().timezone);
  if (state.picks !== week) {
    const summary = weekPicks(ctx.db, week, ctx.now());
    if (summary.picks.length) {
      await postToChannel(discord, picksMessage(summary));
      mark({ picks: week });
      posted.push(`picks:${week}`);
    }
  }
  for (const kind of RECAP_KINDS) {
    const digest = digestMessage(ctx, kind);
    if (!digest || state[kind] === digest.key) continue;
    await postToChannel(discord, digest.message);
    mark({ [kind]: digest.key });
    posted.push(`${kind}:${digest.key}`);
  }
  return { posted };
}
