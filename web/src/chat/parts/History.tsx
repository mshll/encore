/*
 * The list of past conversations, adapted from the chat list in Beautiful UI's Sidebar Nav (MIT, see ./LICENSE):
 * one compact row per conversation, its title truncated, the open one filled.
 */
import { useAskThreads, usePlans, useSets } from "../../api/queries";
import { fmtAgo } from "../../lib/format";
import { AppLink } from "../../ui/AppLink";
import { cx } from "../../ui/cx";
import { RowSkeleton } from "../../ui/Rows";
import { ErrorState } from "../../ui/States";
import { sameThread, threadKey, type ChatMode, type ChatThread } from "../state";

export type HistoryItem = { thread: ChatThread; title: string; at: string };

const EMPTY: Record<ChatMode, string> = {
  ask: "Questions you ask stay here.",
  set: "Sets you make stay here.",
  tidy: "Plans you make stay here.",
};

/** Past conversations of one job, newest first. */
export function useHistory(mode: ChatMode) {
  const ask = useAskThreads();
  const sets = useSets();
  const plans = usePlans();
  const q = mode === "ask" ? ask : mode === "set" ? sets : plans;
  const items: HistoryItem[] | undefined =
    mode === "ask"
      ? ask.data?.items.map((t) => ({ thread: { kind: "ask", id: t.id }, title: t.title, at: t.updatedAt }))
      : mode === "set"
        ? sets.data?.items.map((s) => ({ thread: { kind: "set", id: s.id }, title: s.title, at: s.updatedAt }))
        : plans.data?.items.flatMap((p) => (p.source === "claude" && p.threadId ? [{ thread: { kind: "plan", threadId: p.threadId } as const, title: p.title, at: p.updatedAt }] : []));
  return { items, error: q.error, retry: () => void q.refetch() };
}

const ROW =
  "press flex min-h-8 w-full min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors duration-150 phone:min-h-11";

export function HistoryList({
  mode,
  active,
  limit,
  onPick,
  hrefFor,
}: {
  mode: ChatMode;
  active: ChatThread | null;
  limit?: number;
  /** In the panel a row opens the conversation there. */
  onPick?: (thread: ChatThread) => void;
  /** On the Ask page a row is a link. */
  hrefFor?: (thread: ChatThread) => string;
}) {
  const { items, error, retry } = useHistory(mode);
  if (error) return <ErrorState size="inline" error={error} onRetry={retry} title="Could not load your conversations" />;
  if (!items) return <RowSkeleton rows={4} />;
  if (items.length === 0) return <p className="px-2 text-secondary">{EMPTY[mode]}</p>;
  return (
    <ul className="flex flex-col gap-px">
      {items.slice(0, limit).map((item) => {
        const current = sameThread(item.thread, active);
        const className = cx(ROW, current ? "bg-fill-active text-primary" : "text-secondary hover:bg-fill hover:text-primary");
        const body = (
          <>
            <span className="min-w-0 flex-1 truncate font-medium" title={item.title}>
              {item.title}
            </span>
            <span className="shrink-0 text-caption text-tertiary">
              <time dateTime={item.at}>{fmtAgo(item.at)}</time>
            </span>
          </>
        );
        return (
          <li key={threadKey(item.thread)}>
            {hrefFor ? (
              <AppLink to={hrefFor(item.thread)} aria-current={current ? "page" : undefined} className={className}>
                {body}
              </AppLink>
            ) : (
              <button type="button" aria-current={current ? "true" : undefined} onClick={() => onPick?.(item.thread)} className={className}>
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
