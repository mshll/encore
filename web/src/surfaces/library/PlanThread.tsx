import { useEffect } from "react";
import { Redirect } from "wouter";
import { usePlans } from "../../api/queries";
import { useChat } from "../../chat/state";

/** An old link to a plan's conversation (by its thread): opens the plan's chat over the plans. */
export function PlanThreadPage({ threadId }: { threadId: number }) {
  const { attach } = useChat();
  const plans = usePlans();
  const plan = plans.data?.items.find((p) => p.threadId === threadId);
  useEffect(() => {
    if (plan) void attach({ kind: "plan", id: plan.id });
  }, [plan, attach]);
  if (!plans.data && !plans.isError) return null;
  return <Redirect to="/library/plans" replace />;
}
