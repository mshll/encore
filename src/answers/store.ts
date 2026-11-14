import { eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../db/client";
import { llmAnswers } from "../db/schema";
import type { Answer } from "./answer";

export function saveAnswer(db: DbOrTx, threadId: number, messageIndex: number, answer: Answer, now: number) {
  db.insert(llmAnswers).values({ threadId, messageIndex, content: answer, createdAt: now }).run();
}

/** A thread's structured answers by the index of the assistant message they belong to. Older answers have none. */
export function answersOf(db: Db, threadId: number): Map<number, Answer> {
  return new Map(
    db
      .select()
      .from(llmAnswers)
      .where(eq(llmAnswers.threadId, threadId))
      .all()
      .map((a) => [a.messageIndex, a.content as Answer]),
  );
}
