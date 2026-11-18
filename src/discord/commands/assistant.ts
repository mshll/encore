import { askText, createSetFromText, currentPicks, playSetNow, savePick, saveSetToSpotify, setForChat, updatePickState, type PicksSummary } from "../../assistant/api";
import type { PickState } from "../../db/schema";
import { LlmBudgetExceededError, LlmIncompleteError, LlmNotConfiguredError, LlmRefusalError, LlmTruncatedError } from "../../llm/errors";
import { PickNotFoundError } from "../../picks/state";
import { EmptySetError } from "../../sets/playlist";
import { SetNotBuiltError, SetNotFoundError } from "../../sets/service";
import { UserFacingError } from "../interactions";
import { customId, type DiscordContext, type DiscordRegistry } from "../registry";
import { label, plain, type ActionRow, type Embed, type Message } from "../types";

const MESSAGE_LIMIT = 2000;
const SET_TRACKS_SHOWN = 4;
const PICK_STATES: Record<string, { state: PickState; reply: string }> = {
  save: { state: "saved", reply: "Saved to your library" },
  notnow: { state: "not_now", reply: "Marked not now" },
  never: { state: "never", reply: "Marked never; it won't be suggested again" },
};

/** Assistant errors the owner can act on, as messages; anything else goes to the Discord layer's generic reply. */
async function friendly<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) throw new UserFacingError("AI is not set up.");
    if (error instanceof LlmBudgetExceededError) throw new UserFacingError(`This month's AI budget is used up ($${error.spentUsd.toFixed(2)} of $${error.capUsd}).`);
    if (error instanceof LlmRefusalError) throw new UserFacingError("The AI declined that request.");
    if (error instanceof LlmTruncatedError || error instanceof LlmIncompleteError || error instanceof SetNotBuiltError) throw new UserFacingError("The AI stopped before finishing. Try again.");
    if (error instanceof SetNotFoundError || error instanceof PickNotFoundError) throw new UserFacingError("That no longer exists.");
    if (error instanceof EmptySetError) throw new UserFacingError("That set has no tracks.");
    throw error;
  }
}

const trackUrl = (uri: string) => `https://open.spotify.com/track/${uri.split(":").pop()}`;

export function setMessage(ctx: DiscordContext, setId: number, reply: string | null = null): Message {
  const set = setForChat(ctx.services.assistant, setId);
  const newCount = set.items.filter((i) => i.kind === "new").length;
  const head: Embed = {
    title: plain(set.title),
    url: set.dashboardUrl,
    description: plain(set.description, 1024),
    footer: { text: `${set.items.length} tracks, ${newCount} new` },
  };
  const tracks: Embed[] = set.items.slice(0, SET_TRACKS_SHOWN).map((i) => ({
    title: plain(`${i.position}. ${i.name}`),
    url: trackUrl(i.uri),
    description: plain(`${i.artist}${i.kind === "new" ? " (new to you)" : ""}\n${i.reason}`, 1024),
    ...(i.albumArtUrl ? { thumbnail: { url: i.albumArtUrl } } : {}),
  }));
  const buttons: ActionRow = {
    type: 1,
    components: [
      { type: 2, style: 1, label: "Save to Spotify", custom_id: customId("setsave", String(set.id)) },
      { type: 2, style: 2, label: "Play now", custom_id: customId("setplay", String(set.id)) },
      { type: 2, style: 5, label: "Open in dashboard", url: set.dashboardUrl },
    ],
  };
  return { ...(reply ? { content: plain(reply, MESSAGE_LIMIT) } : {}), embeds: [head, ...tracks], components: set.items.length ? [buttons] : [] };
}

export function picksMessage(summary: PicksSummary, heading = "This week's picks"): Message {
  if (summary.picks.length === 0) return { content: "No picks this week yet." };
  const embeds: Embed[] = summary.picks.slice(0, 10).map((p) => ({
    title: plain(`${p.position}. ${p.name}`),
    url: trackUrl(p.uri),
    author: { name: plain(`${p.artist}${p.distance === "far" ? " · further out" : ""}`) },
    description: plain(p.reason, 3000) + (p.source ? `\n[${plain(p.source.title ?? "Source", 200)}](${p.source.url})` : ""),
    ...(p.albumArtUrl ? { thumbnail: { url: p.albumArtUrl } } : {}),
    ...(p.state !== "new" ? { footer: { text: p.state === "not_now" ? "not now" : p.state } } : {}),
  }));
  const rows: ActionRow[] = summary.picks.slice(0, 5).map((p) => ({
    type: 1,
    components: [
      { type: 2, style: 1, label: label(`Save ${p.position}`), custom_id: customId("pick", `${p.id}:save`) },
      { type: 2, style: 2, label: "Not now", custom_id: customId("pick", `${p.id}:notnow`) },
      { type: 2, style: 2, label: "Never", custom_id: customId("pick", `${p.id}:never`) },
    ],
  }));
  return { content: `${heading}, week of ${summary.week}:`, embeds, components: rows };
}

export function registerAssistantCommands(registry: DiscordRegistry): DiscordRegistry {
  return registry
    .addCommand({
      definition: { name: "set", description: "Build a set for a moment", options: [{ type: 3, name: "moment", description: "The moment, in your words", required: true }] },
      defer: true,
      handle: ({ ctx, options }) =>
        friendly(async () => {
          const moment = String(options.moment ?? "").trim();
          if (!moment || moment.length > 1000) throw new UserFacingError("Describe the moment in up to 1000 characters.");
          const summary = await createSetFromText(ctx.services.assistant, moment);
          return setMessage(ctx, summary.id, summary.reply);
        }),
    })
    .addCommand({
      definition: { name: "picks", description: "This week's picks" },
      defer: false,
      handle: async ({ ctx }) => picksMessage(await currentPicks(ctx.services.assistant)),
    })
    .addCommand({
      definition: { name: "ask", description: "Ask about your listening", options: [{ type: 3, name: "question", description: "Your question", required: true }] },
      defer: true,
      handle: ({ ctx, options }) =>
        friendly(async () => {
          const question = String(options.question ?? "").trim();
          if (!question || question.length > 1000) throw new UserFacingError("Ask in up to 1000 characters.");
          const { text } = await askText(ctx.services.assistant, question);
          return { content: plain(text, MESSAGE_LIMIT) };
        }),
    })
    .addComponent({
      prefix: "setsave",
      defer: true,
      ephemeral: true,
      handle: ({ ctx, arg }) =>
        friendly(async () => {
          const saved = await saveSetToSpotify(ctx.services.assistant, Number(arg));
          return { content: `Saved ${saved.tracks} tracks to a private playlist: ${saved.playlistUrl}` };
        }),
    })
    .addComponent({
      prefix: "setplay",
      defer: true,
      ephemeral: true,
      handle: ({ ctx, arg }) =>
        friendly(async () => {
          const session = await playSetNow(ctx.services.assistant, ctx.services.dj, Number(arg));
          return { content: `Playing ${session.uris.length} tracks.` };
        }),
    })
    .addComponent({
      prefix: "pick",
      defer: true,
      ephemeral: true,
      handle: ({ ctx, arg }) =>
        friendly(async () => {
          const [id, action] = arg.split(":");
          const choice = PICK_STATES[action ?? ""];
          if (!choice || !Number(id)) throw new UserFacingError("This button no longer works.");
          const pick = choice.state === "saved" ? await savePick(ctx.services.assistant, Number(id)) : updatePickState(ctx.services.assistant, Number(id), choice.state);
          return { content: `${choice.reply}: ${plain(pick.name)} by ${plain(pick.artist)}.` };
        }),
    });
}
