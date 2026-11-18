import { eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { llmThreads, type LlmFeature } from "../db/schema";
import { replyText, type ChatMessage } from "./types";

export type Thread = { id: number; feature: LlmFeature; system: string[]; messages: ChatMessage[]; createdAt: number; updatedAt: number };

export function createThread(db: DbOrTx, feature: LlmFeature, system: string[], messages: ChatMessage[], now: number): number {
  return db
    .insert(llmThreads)
    .values({ feature, system: JSON.stringify(system), messages, createdAt: now, updatedAt: now })
    .returning({ id: llmThreads.id })
    .get().id;
}

export function getThread(db: Db, id: number): Thread | null {
  const row = db.select().from(llmThreads).where(eq(llmThreads.id, id)).get();
  return row ? { ...row, system: JSON.parse(row.system) as string[], messages: row.messages as ChatMessage[] } : null;
}

export function saveThreadMessages(db: DbOrTx, id: number, messages: ChatMessage[], now: number) {
  db.update(llmThreads).set({ messages, updatedAt: now }).where(eq(llmThreads.id, id)).run();
}

export function deleteThread(db: DbOrTx, id: number) {
  db.delete(llmThreads).where(eq(llmThreads.id, id)).run();
}

export const ownerMessage = (text: string) => `<owner_message>\n${text}\n</owner_message>`;

/** The owner's messages and the model's visible text replies, each with the index of the message it came from. */
export function transcriptTurns(messages: ChatMessage[]) {
  const turns: { role: "owner" | "assistant"; text: string; message: number }[] = [];
  messages.forEach((m, message) => {
    if (m.role === "user") {
      if (typeof m.content !== "string") return;
      const match = /<owner_message>\n([\s\S]*?)\n<\/owner_message>/.exec(m.content);
      if (match) turns.push({ role: "owner", text: match[1]!, message });
      return;
    }
    const text = replyText(m.content);
    if (text) turns.push({ role: "assistant", text, message });
  });
  return turns;
}

/** The owner's messages and the model's visible text replies, for display. */
export function transcript(messages: ChatMessage[]) {
  return transcriptTurns(messages).map(({ role, text }) => ({ role, text }));
}
