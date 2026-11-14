import { useEffect, type RefObject } from "react";

/** Taller than any browser bar, shorter than any software keyboard. */
const KEYBOARD_MIN = 120;
const RESTORE_WINDOW_MS = 1000;

/**
 * iOS does not resize the layout for the software keyboard: it pans the page under it. While the keyboard is up,
 * this publishes the visible area (`--app-top`, `--app-h`) and the keyboard's height (`--keyboard-inset`) on the
 * root, and marks it `data-keyboard-open`, so the shell can fit the area above the keyboard.
 */
export function useSoftKeyboard(enabled: boolean, scroller: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const view = window.visualViewport;
    if (!enabled || !view) return;
    const root = document.documentElement;
    const clear = () => {
      if (!root.hasAttribute("data-keyboard-open")) return;
      root.removeAttribute("data-keyboard-open");
      for (const name of ["--app-top", "--app-h", "--keyboard-inset"]) root.style.removeProperty(name);
      // WebKit restores the offset the scroller had above the keyboard (about 50 ms later, in iOS 26), which is past
      // the end of the grown scroller and leaves a gap under the content. Pull it back once, then stop listening so a
      // later rubber band at the end is left alone.
      const el = scroller.current;
      if (!el) return;
      const clamp = () => {
        const end = el.scrollHeight - el.clientHeight;
        if (el.scrollTop <= end) return;
        el.scrollTop = end;
        el.removeEventListener("scroll", clamp);
      };
      clamp();
      el.addEventListener("scroll", clamp, { passive: true });
      setTimeout(() => el.removeEventListener("scroll", clamp), RESTORE_WINDOW_MS);
    };
    const update = () => {
      // innerHeight shrinks with the keyboard in iOS 26 Safari; the root's client height is the layout viewport.
      const layout = root.clientHeight;
      const zoomed = Math.abs(view.scale - 1) > 0.01;
      if (layout - view.height < KEYBOARD_MIN || zoomed) return clear();
      root.setAttribute("data-keyboard-open", "");
      root.style.setProperty("--app-top", `${view.offsetTop}px`);
      root.style.setProperty("--app-h", `${view.height}px`);
      root.style.setProperty("--keyboard-inset", `${Math.max(0, layout - view.offsetTop - view.height)}px`);
    };
    update();
    view.addEventListener("resize", update);
    view.addEventListener("scroll", update);
    return () => {
      view.removeEventListener("resize", update);
      view.removeEventListener("scroll", update);
      clear();
    };
  }, [enabled, scroller]);
}
