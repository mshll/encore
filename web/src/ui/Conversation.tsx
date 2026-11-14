import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useScrollElement } from "../app/Shell";
import { Button } from "./Button";
import { cx } from "./cx";
import { ArrowDownIcon } from "./icons";

const NEAR_END = 64;

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
  className?: string;
}) {
  const pinned = Boolean(messages);
  const page = useScrollElement();
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
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
          <div ref={content} className="flex flex-col pb-6">
            {messages}
          </div>
        </div>
      )}
      <div
        ref={dock}
        className={cx(
          "flex flex-col gap-3",
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
      {!pinned && empty}
    </div>
  );
}
