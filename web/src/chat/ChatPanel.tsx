/*
 * The chat panel's frame, after Beautiful UI's Chat (MIT, see ./parts/LICENSE): a header row with the conversation's
 * name and its actions over a hairline, the conversation, the prompt bar at the foot.
 */
import { useRef, useState, type PointerEvent } from "react";
import { useLocation } from "wouter";
import { useConversation } from "../api/queries";
import { IconButton } from "../ui/Button";
import { cx } from "../ui/cx";
import { ArrowLeftIcon, ArrowsInSimpleIcon, ArrowsOutSimpleIcon, ClockCounterClockwiseIcon, NotePencilIcon, XIcon } from "../ui/icons";
import { Chat, SubjectChip, useSubject } from "./Chat";
import { HistoryList } from "./parts/History";
import { useChat } from "./state";

/** The open conversation's name: its title, else "New chat". */
export function useConversationTitle(): string {
  const { conversation } = useChat();
  const q = useConversation(conversation);
  if (conversation === null) return "New chat";
  return q.data?.title ?? "Conversation";
}

const FRAME = {
  dock: "h-full w-(--chat-w) rounded-xl bg-container shadow-panel",
  sheet:
    "absolute inset-0 z-30 bg-container pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] animate-[sheet-up_var(--dur-modal)_var(--ease-drawer)_both] in-data-keyboard-open:pb-0",
  pane: "h-full min-h-0 bg-card",
};

/** A drag this far down, or a flick, closes the sheet. */
const DISMISS_PX = 120;
const FLICK_PX_PER_MS = 0.5;

/**
 * Swipe down on the sheet's header to close it. The header takes every touch (`touch-none`), so the browser neither
 * scrolls nor zooms while it is dragged; its buttons keep their taps.
 */
function useSwipeToClose(onClose: () => void) {
  const panel = useRef<HTMLElement>(null);
  const start = useRef<{ y: number; at: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = (dy: number) => {
    if (panel.current) panel.current.style.transform = dy ? `translateY(${dy}px)` : "";
  };
  // The Web Animations API, not a transition: the entrance animation's fill holds `transform`, so a transition never ends.
  const settle = (el: HTMLElement, from: number, to: number, done?: () => void) => {
    const cs = getComputedStyle(el);
    const anim = el.animate([{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }], {
      duration: parseFloat(cs.getPropertyValue("--dur-modal")) || 240,
      easing: cs.getPropertyValue("--ease-drawer").trim() || "ease-out",
      fill: "forwards",
    });
    drag(0);
    anim.onfinish = done ?? (() => anim.cancel());
  };
  const end = (e: PointerEvent) => {
    const from = start.current;
    start.current = null;
    const el = panel.current;
    if (!from || !el) return setDragging(false);
    const dy = Math.max(0, e.clientY - from.y);
    if (dy < DISMISS_PX && dy / Math.max(1, e.timeStamp - from.at) < FLICK_PX_PER_MS) {
      setDragging(false);
      return settle(el, dy, 0);
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onClose();
    settle(el, dy, el.offsetHeight, onClose);
  };
  return {
    panel,
    dragging,
    handle: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === "mouse" || (e.target as Element).closest("button")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, at: e.timeStamp };
        setDragging(true);
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        if (start.current) drag(Math.max(0, e.clientY - start.current.y));
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
  };
}

/**
 * The panel: docked in the shell's right slot on desktop, a full-screen sheet over the page and the dock on a phone, and on
 * the full chat page the conversation pane beside the history, flush with the page panel's edges.
 */
export function ChatPanel({ place }: { place: keyof typeof FRAME }) {
  const chat = useChat();
  const [, navigate] = useLocation();
  const [history, setHistory] = useState(false);
  const title = useConversationTitle();
  const subject = useSubject();
  const onPage = place === "pane";
  const swipe = useSwipeToClose(chat.close);
  const sheet = place === "sheet";
  const showHistory = history && !onPage;
  return (
    <aside ref={swipe.panel} aria-label="Chat" data-chat-dragging={swipe.dragging || undefined} className={cx("flex flex-col overflow-hidden", FRAME[place])}>
      <header {...(sheet ? swipe.handle : {})} className={cx("relative flex h-12 shrink-0 items-center gap-1 pr-1.5 pl-2 hairline-b phone:h-14", sheet && "touch-none select-none")}>
        {sheet && <span aria-hidden className="absolute top-1.5 left-1/2 h-[5px] w-9 -translate-x-1/2 rounded-full bg-fill-active" />}
        {showHistory && <IconButton icon={ArrowLeftIcon} label="Back to the conversation" size="sm" onClick={() => setHistory(false)} />}
        <h2 title={showHistory ? undefined : title} className={cx("min-w-0 flex-1 truncate font-medium text-primary", !showHistory && "pl-2")}>
          {showHistory ? "History" : title}
        </h2>
        {!showHistory && (
          <>
            <IconButton icon={NotePencilIcon} label="New chat" size="sm" onClick={() => (onPage ? navigate("/chat") : chat.show({ conversation: null }))} />
            {!onPage && <IconButton icon={ClockCounterClockwiseIcon} label="History" size="sm" onClick={() => setHistory(true)} />}
            {place === "dock" && <IconButton icon={ArrowsOutSimpleIcon} label="Expand" size="sm" onClick={chat.expand} />}
          </>
        )}
        {onPage ? <IconButton icon={ArrowsInSimpleIcon} label="Collapse to the panel" size="sm" onClick={chat.collapse} /> : <IconButton icon={XIcon} label="Close chat" size="sm" onClick={chat.close} />}
      </header>
      {showHistory ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pt-3 pb-4">
          <HistoryList
            onPick={(conversation) => {
              chat.show({ conversation });
              setHistory(false);
            }}
          />
        </div>
      ) : (
        <>
          {subject && (
            <div className="shrink-0 px-2 pt-2">
              <SubjectChip subject={subject} />
            </div>
          )}
          <Chat variant="panel" />
        </>
      )}
    </aside>
  );
}
