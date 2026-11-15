/*
 * The chat panel's frame, after Beautiful UI's Chat (MIT, see ./parts/LICENSE): a header row with the conversation's
 * name and its actions over a hairline, the conversation, the prompt bar at the foot.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useAskThread, usePlans, useSet } from "../api/queries";
import { IconButton } from "../ui/Button";
import { cx } from "../ui/cx";
import { ArrowLeftIcon, ArrowsInSimpleIcon, ArrowsOutSimpleIcon, ClockCounterClockwiseIcon, NotePencilIcon, XIcon } from "../ui/icons";
import { AppLink } from "../ui/AppLink";
import { Segmented } from "../ui/Segmented";
import { Chat, MODE_LABELS } from "./Chat";
import { HistoryList } from "./parts/History";
import { useChat, type ChatMode, type ChatThread } from "./state";

const ALL: Record<ChatMode, { label: string; path: string }> = {
  ask: { label: "All questions", path: "/ask" },
  set: { label: "All sets", path: "/sets" },
  tidy: { label: "All plans", path: "/library/plans" },
};

/** The open conversation's name: its first question, the set's or the plan's title. */
function useThreadTitle(thread: ChatThread | null): string {
  const ask = useAskThread(thread?.kind === "ask" ? thread.id : null);
  const set = useSet(thread?.kind === "set" ? thread.id : 0);
  const plans = usePlans();
  if (!thread) return "New chat";
  if (thread.kind === "ask") return ask.data?.title ?? "Question";
  if (thread.kind === "set") return set.data?.title ?? "Set";
  return plans.data?.items.find((p) => p.threadId === thread.threadId)?.title ?? "Plan with Claude";
}

function History({ onPicked }: { onPicked: () => void }) {
  const chat = useChat();
  const [mode, setMode] = useState<ChatMode>(chat.mode);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-2 pt-3 pb-4">
      <div className="px-2">
        <Segmented
          label="Conversations"
          value={mode}
          onChange={setMode}
          options={(Object.keys(MODE_LABELS) as ChatMode[]).map((m) => ({ value: m, label: MODE_LABELS[m] }))}
          className="w-full"
        />
      </div>
      <HistoryList
        mode={mode}
        active={chat.thread}
        limit={12}
        onPick={(thread) => {
          chat.show({ thread });
          onPicked();
        }}
      />
      <AppLink to={ALL[mode].path} onClick={chat.leave} className="w-fit rounded-xs px-2 text-caption font-medium text-secondary hover:text-primary hover:underline">
        {ALL[mode].label}
      </AppLink>
    </div>
  );
}

const FRAME = {
  dock: "h-full w-(--chat-w) rounded-xl bg-container shadow-panel",
  sheet: "absolute inset-0 z-30 bg-container pt-[env(safe-area-inset-top)] animate-[sheet-up_var(--dur-modal)_var(--ease-drawer)_both]",
  pane: "h-full min-h-0 bg-card",
};

/**
 * The panel: docked in the shell's right slot on desktop, a full-height sheet over the page on a phone, and on the Ask
 * page the same frame as the pane beside the list of questions, flush with the page panel's edges.
 */
export function ChatPanel({ place }: { place: keyof typeof FRAME }) {
  const chat = useChat();
  const [, navigate] = useLocation();
  const [history, setHistory] = useState(false);
  const title = useThreadTitle(chat.thread);
  const onPage = place === "pane";
  return (
    <aside aria-label="Chat" className={cx("flex flex-col overflow-hidden", FRAME[place])}>
      <header className="flex h-12 shrink-0 items-center gap-1 pr-1.5 pl-2 hairline-b phone:h-14">
        {history ? (
          <IconButton icon={ArrowLeftIcon} label="Back to the conversation" size="sm" onClick={() => setHistory(false)} />
        ) : null}
        <h2 title={history ? undefined : title} className={cx("min-w-0 flex-1 truncate font-medium text-primary", !history && "pl-2")}>
          {history ? "History" : title}
        </h2>
        {!history && (
          <>
            <IconButton icon={NotePencilIcon} label="New chat" size="sm" onClick={() => (onPage ? navigate("/ask") : chat.show({ thread: null }))} />
            {!onPage && <IconButton icon={ClockCounterClockwiseIcon} label="History" size="sm" onClick={() => setHistory(true)} />}
            {chat.mode === "ask" && place === "dock" && <IconButton icon={ArrowsOutSimpleIcon} label="Open in full width" size="sm" onClick={chat.expand} />}
          </>
        )}
        {onPage ? (
          <IconButton icon={ArrowsInSimpleIcon} label="Open in panel" size="sm" onClick={chat.collapse} />
        ) : (
          <IconButton icon={XIcon} label="Close chat" size="sm" onClick={chat.close} />
        )}
      </header>
      {history ? <History onPicked={() => setHistory(false)} /> : <Chat variant="panel" />}
    </aside>
  );
}
