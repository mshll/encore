import { useEffect } from "react";
import { Redirect } from "wouter";
import { useChat } from "../../chat/state";

/** An old link to a planning conversation whose first turn was Claude's question: it opens in the chat, over the plans. */
export function PlanThreadPage({ threadId }: { threadId: number }) {
  const { show } = useChat();
  useEffect(() => show({ thread: { kind: "plan", threadId } }), [threadId, show]);
  return <Redirect to="/library/plans" replace />;
}
