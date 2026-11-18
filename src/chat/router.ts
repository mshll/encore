import type { ChatTask } from "../db/schema";
import type { FeatureContext } from "../llm/context";
import { LlmTruncatedError } from "../llm/errors";
import { replyText } from "../llm/types";
import { ownerMessage } from "../llm/threads";

export const ROUTER_SYSTEM = `Pick the task for the owner's latest message to encore, their private Spotify listening dashboard.
- answer: a question about their listening (numbers, trends, when, why).
- set: build a playlist of songs now for a moment, mood or activity.
- rule: a playlist that refills itself from a rule over their history ("my most played of the last month", "songs I loved in 2019 but stopped playing").
- plan: tidy their Spotify library: liked songs and their own playlists (archive, remove, dedupe, like, sort into playlists).
- play: play or queue songs now ("play something by Frank Ocean", "queue my top songs from last week").
- refine: change the attached set or plan.
Reply with JSON only.`;

const schema = (tasks: readonly ChatTask[]) => ({
  type: "object",
  properties: { task: { type: "string", enum: tasks } },
  required: ["task"],
  additionalProperties: false,
});

export type RouteInput = {
  message: string;
  /** Where the owner is, in words ("the artist page for \"Mac Miller\""). */
  page?: string;
  /** The set or plan the conversation is attached to, in words. */
  subject?: string;
  /** The last few turns, each as one line. */
  earlier: string[];
};

export const ROUTE_TASKS: readonly ChatTask[] = ["answer", "set", "rule", "plan", "play"];

/** One small structured call that names the task. An unreadable reply falls back to an answer: it changes nothing. */
export async function routeMessage(ctx: FeatureContext, input: RouteInput, ref?: string): Promise<ChatTask> {
  const tasks: ChatTask[] = input.subject ? [...ROUTE_TASKS, "refine"] : [...ROUTE_TASKS];
  const lines = [ownerMessage(input.message)];
  if (input.page) lines.push(`Sent from ${input.page}.`);
  if (input.subject) lines.push(`Attached: ${input.subject}.`);
  if (input.earlier.length) lines.push(`Earlier:\n${input.earlier.join("\n")}`);
  const reply = await ctx.llm.call({
    feature: "chat",
    ref,
    system: [ROUTER_SYSTEM],
    messages: [{ role: "user", content: lines.join("\n") }],
    effort: "low",
    maxTokens: 1000,
    jsonSchema: schema(tasks),
  });
  if (reply.stopReason === "max_tokens") throw new LlmTruncatedError();
  return parseTask(replyText(reply.content), tasks);
}

export function parseTask(text: string, tasks: readonly ChatTask[]): ChatTask {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return "answer";
  try {
    const task = (JSON.parse(json) as { task?: unknown }).task;
    return tasks.includes(task as ChatTask) ? (task as ChatTask) : "answer";
  } catch {
    return "answer";
  }
}
