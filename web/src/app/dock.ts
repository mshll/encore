import { useCallback, useEffect, useState, type RefObject } from "react";

/** Scroll travel in one direction before the dock changes, so a finger's jitter does not flip it. */
const TRAVEL = 16;
/** Within this distance of the top or the end, the dock is expanded. */
const EDGE = 8;

/**
 * The phone dock collapses while the page scrolls down and expands when it scrolls up or reaches the top or the end.
 * The state is also published on the root (`data-dock-collapsed`) so `--bottom-chrome` follows it for toasts.
 */
export function useDockCollapse(scroller: RefObject<HTMLElement | null>, enabled: boolean): { collapsed: boolean; expand: () => void } {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !enabled) return;
    let last = el.scrollTop;
    let travel = 0;
    const onScroll = () => {
      const top = el.scrollTop;
      const delta = top - last;
      last = top;
      if (top <= EDGE || top >= el.scrollHeight - el.clientHeight - EDGE) {
        travel = 0;
        setCollapsed(false);
        return;
      }
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel > TRAVEL) setCollapsed(true);
      else if (travel < -TRAVEL) setCollapsed(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      setCollapsed(false);
    };
  }, [scroller, enabled]);
  useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute("data-dock-collapsed", collapsed);
    return () => root.removeAttribute("data-dock-collapsed");
  }, [collapsed]);
  const expand = useCallback(() => setCollapsed(false), []);
  return { collapsed, expand };
}
