import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as Sheet } from "@base-ui/react/dialog";
import { useScrollElement } from "../app/Shell";
import { useMedia } from "../lib/useMedia";
import { Button, IconButton } from "./Button";
import { cx } from "./cx";
import { ArrowDownIcon, XIcon } from "./icons";
import { BACKDROP } from "./surfaces";

const NEAR_END = 64;

/** How long the thread stays at its end after the composer takes focus: the software keyboard resizes the view meanwhile. */
const KEYBOARD_SETTLE_MS = 800;

/** A CSS time token in milliseconds: the build writes 300ms as .3s. */
const ms = (time: string) => parseFloat(time) * (time.trim().endsWith("ms") ? 1 : 1000);

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A thread with its composer. With no messages the composer sits in the flow with `empty` under it (starters).
 * From the first message (or a starting run) the composer is pinned to the bottom of the column and the messages
 * scroll above it. The view follows new content while the reader is at the end, and offers Jump to latest when not.
 */
export function Conversation({
  messages,
  composer,
  empty,
  follow,
  startAtEnd = false,
  thread,
  contained = false,
  inset = false,
  className,
}: {
  /** The thread; null or false while it has no messages. */
  messages: ReactNode;
  /** The composer with the notices tied to it (cap reached, Claude not set up, a failed run). */
  composer: ReactNode;
  /** Under the composer while the thread is empty. */
  empty?: ReactNode;
  /** Changes when a message is added: the view moves to the end. */
  follow: unknown;
  /** Open at the newest message rather than the top of the page. */
  startAtEnd?: boolean;
  /** Identifies the thread: opening another one starts again at its newest message. */
  thread?: unknown;
  /** Its own scroll box, filling the parent's height (a side column). Otherwise the page panel scrolls. */
  contained?: boolean;
  /** Pads the messages and the composer off the edges of a surface (`ConversationPanel`). */
  inset?: boolean;
  className?: string;
}) {
  const pinned = Boolean(messages);
  const page = useScrollElement();
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const holdEndUntil = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const scroller = useCallback(() => (contained ? box.current : page.current), [contained, page]);

  /** How far the newest message runs past the top of the composer: 0 when it is in sight. */
  const pastEnd = useCallback(() => {
    if (!content.current || !dock.current) return 0;
    return content.current.getBoundingClientRect().bottom - dock.current.getBoundingClientRect().top;
  }, []);

  const toEnd = useCallback(
    (smooth: boolean) => {
      atEnd.current = true;
      setShowJump(false);
      scroller()?.scrollBy({ top: pastEnd(), behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
    },
    [scroller, pastEnd],
  );

  useEffect(() => {
    const el = scroller();
    if (!el || !pinned) return;
    const onScroll = () => {
      if (performance.now() < holdEndUntil.current) {
        const gap = pastEnd();
        if (gap > 1) el.scrollBy({ top: gap });
        return;
      }
      atEnd.current = pastEnd() < NEAR_END;
      setShowJump(!atEnd.current);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scroller, pastEnd, pinned]);

  useEffect(() => {
    if (!content.current || !dock.current || !pinned) return;
    atEnd.current = pastEnd() < NEAR_END;
    const observer = new ResizeObserver(() => {
      if (atEnd.current) scroller()?.scrollBy({ top: pastEnd() });
    });
    observer.observe(content.current);
    observer.observe(dock.current);
    const el = scroller();
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [scroller, pastEnd, pinned]);

  const lastFollow = useRef(follow);
  useEffect(() => {
    if (Object.is(lastFollow.current, follow)) return;
    lastFollow.current = follow;
    if (pinned) toEnd(true);
  }, [follow, pinned, toEnd]);

  // A frame later, so it lands after the shell's own scroll-to-top on a new address.
  useEffect(() => {
    if (!startAtEnd && !contained) return;
    const frame = requestAnimationFrame(() => toEnd(false));
    return () => cancelAnimationFrame(frame);
  }, [startAtEnd, contained, thread, toEnd]);

  // FLIP: the composer glides from its place under the header to the foot of the column, and back.
  const wasPinned = useRef(pinned);
  const before = useRef<number | null>(null);
  if (wasPinned.current !== pinned && dock.current) before.current = dock.current.getBoundingClientRect().top;
  useLayoutEffect(() => {
    if (wasPinned.current === pinned) return;
    wasPinned.current = pinned;
    const el = dock.current;
    const from = before.current;
    before.current = null;
    if (!el || from === null || reducedMotion()) return;
    const delta = from - el.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) return;
    const tokens = getComputedStyle(el);
    el.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], {
      duration: ms(tokens.getPropertyValue("--dur-move")),
      easing: tokens.getPropertyValue("--ease-move"),
    });
  }, [pinned]);

  return (
    <div className={cx("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      {pinned && (
        <div ref={box} className={cx("flex flex-1 flex-col", contained && "min-h-0 overflow-y-auto overscroll-contain")}>
          <div ref={content} className={cx("flex flex-col pb-6", inset && "px-4 pt-1")}>
            {messages}
          </div>
        </div>
      )}
      <div
        ref={dock}
        onFocus={() => {
          if (pinned && atEnd.current) holdEndUntil.current = performance.now() + KEYBOARD_SETTLE_MS;
        }}
        className={cx(
          "flex flex-col gap-3",
          inset && "px-3 pb-3 [--gutter:--spacing(3)]",
          pinned && "relative pt-1",
          pinned && !contained && "sticky bottom-0 z-10 bg-page pb-4 phone:-mx-(--gutter) phone:px-(--gutter) md:pb-6",
        )}
      >
        {pinned && showJump && (
          <Button
            size="sm"
            icon={ArrowDownIcon}
            onClick={() => toEnd(true)}
            className="absolute -top-11 left-1/2 -translate-x-1/2 bg-overlay shadow-overlay hover:bg-overlay"
          >
            Jump to latest
          </Button>
        )}
        {composer}
      </div>
      {!pinned && (inset ? <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{empty}</div> : empty)}
    </div>
  );
}

type ConversationProps = Omit<Parameters<typeof Conversation>[0], "contained" | "inset" | "className">;

/** The panel's own surface: a header that names it, the thread scrolling inside, the composer pinned at its foot. */
function PanelSurface({ title, actions, className, ...conversation }: ConversationProps & { title: string; actions?: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cx("flex min-h-0 flex-col overflow-hidden rounded-2xl bg-card shadow-panel", className)}>
      <header className="flex min-h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2 title={title} className="min-w-0 flex-1 truncate font-medium text-primary">
          {title}
        </h2>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <Conversation {...conversation} contained inset />
    </section>
  );
}

/**
 * A conversation with Claude as its own docked panel (the set page, Ask, Library). From `lg` (`useDocked`): a panel that
 * fills the height its parent gives it (`DOCKED` in a page column). Narrower: with `sheet`, the same panel in a bottom sheet the
 * page opens from a button; it stays mounted while closed, so a run keeps reporting to it. Without `sheet`, the
 * conversation is the page: no surface, the page scrolls and the composer sticks above the tab bar.
 */
export function ConversationPanel({
  title,
  actions,
  sheet,
  flatHeader = true,
  className,
  ...conversation
}: ConversationProps & {
  /** What the panel holds: "Change the set", a thread's title. */
  title: string;
  /** Beside the title (a thread's More menu). */
  actions?: ReactNode;
  /** Phone only: the panel opens as a bottom sheet. */
  sheet?: { open: boolean; onOpenChange: (open: boolean) => void };
  /** Phone without a sheet: show the title row above the thread. */
  flatHeader?: boolean;
  className?: string;
}) {
  const docked = useDocked();
  if (docked) return <PanelSurface title={title} actions={actions} className={className} {...conversation} />;
  if (sheet)
    return (
      <Sheet.Root open={sheet.open} onOpenChange={sheet.onOpenChange}>
        <Sheet.Portal keepMounted>
          <Sheet.Backdrop className={BACKDROP} />
          <Sheet.Popup
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 flex h-[calc(100dvh-24px)] flex-col rounded-t-[14px] bg-overlay pb-[env(safe-area-inset-bottom)] shadow-modal outline-none transition-transform duration-300 ease-(--ease-drawer) data-[ending-style]:translate-y-full data-[ending-style]:duration-200 data-[starting-style]:translate-y-full motion-reduce:transition-none"
          >
            <header className="flex min-h-14 shrink-0 items-center gap-2 pr-2 pl-4">
              <Sheet.Title className="min-w-0 flex-1 truncate text-heading font-medium text-primary">{title}</Sheet.Title>
              {actions}
              <Sheet.Close render={<IconButton icon={XIcon} label="Close" />} />
            </header>
            <Conversation {...conversation} contained inset />
          </Sheet.Popup>
        </Sheet.Portal>
      </Sheet.Root>
    );
  return (
    <div className={cx("flex min-h-0 flex-1 flex-col gap-4", className)}>
      {flatHeader && (
        <div className="flex min-h-11 items-center gap-2">
          <h2 title={title} className="min-w-0 flex-1 truncate text-heading font-medium text-primary">
            {title}
          </h2>
          {actions}
        </div>
      )}
      <Conversation {...conversation} />
    </div>
  );
}

/** True from `lg`, where a conversation panel docks beside the page's content. */
export const useDocked = () => useMedia("(min-width: 1024px)");

/** Classes for a docked panel in a page column from `lg`: sticks under the frame's top band and ends one gutter above the panel's foot. */
export const DOCKED = "lg:sticky lg:top-12 lg:h-[calc(100dvh-var(--bottom-chrome)-var(--inset)-80px)]";
