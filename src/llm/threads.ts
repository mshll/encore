import { eq } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db, DbOrTx } from "../db/client";
import { llmThreads, type LlmFeature } from "../db/schema";
import type { MessageParam } from "./client";

export type Thread = { id: number; feature: LlmFeature; system: string[]; messages: MessageParam[]; createdAt: number; updatedAt: number };

export function createThread(db: DbOrTx, feature: LlmFeature, system: string[], messages: MessageParam[], now: number): number {
  return db
    .insert(llmThreads)
    .values({ feature, system: JSON.stringify(system), messages, createdAt: now, updatedAt: now })
    .returning({ id: llmThreads.id })
    .get().id;
}

export function getThread(db: Db, id: number): Thread | null {
  const row = db.select().from(llmThreads).where(eq(llmThreads.id, id)).get();
  return row ? { ...row, system: JSON.parse(row.system) as string[], messages: row.messages as MessageParam[] } : null;
}

export function saveThreadMessages(db: DbOrTx, id: number, messages: MessageParam[], now: number) {
  db.update(llmThreads).set({ messages, updatedAt: now }).where(eq(llmThreads.id, id)).run();
}

export function deleteThread(db: DbOrTx, id: number) {
  db.delete(llmThreads).where(eq(llmThreads.id, id)).run();
}

export const ownerMessage = (text: string) => `<owner_message>\n${text}\n</owner_message>`;

/** The owner's messages and Claude's visible text replies, each with the index of the message it came from. */
export function transcriptTurns(messages: MessageParam[]) {
  const turns: { role: "owner" | "assistant"; text: string; message: number }[] = [];
  messages.forEach((m, message) => {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content } as Anthropic.Beta.BetaTextBlockParam] : (m.content ?? []);
    const text = blocks
      .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return;
    if (m.role === "user") {
      const match = /<owner_message>\n([\s\S]*?)\n<\/owner_message>/.exec(text);
      if (match) turns.push({ role: "owner", text: match[1]!, message });
    } else turns.push({ role: "assistant", text, message });
  });
  return turns;
}

/** The owner's messages and Claude's visible text replies, for display. */
export function transcript(messages: MessageParam[]) {
  return transcriptTurns(messages).map(({ role, text }) => ({ role, text }));
}
