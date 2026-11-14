import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useRangeHref } from "../ui/AppLink";
import { SURFACES } from "./nav";

/**
 * Keys that work on every surface: ⌘K (Ctrl+K) toggles the palette, `G` then a letter jumps to a surface
 * (as listed in the palette). The jump is ignored while typing in a field.
 */
export function useShortcuts(togglePalette: () => void): void {
  const [, navigate] = useLocation();
  const href = useRangeHref();
  const latest = useRef({ navigate, href, togglePalette });
  latest.current = { navigate, href, togglePalette };
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        latest.current.togglePalette();
        return;
      }
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest("input,textarea,select,[contenteditable=true]")) return;
      if (e.key === "g") {
        armed = Date.now();
        return;
      }
      if (Date.now() - armed < 1000) {
        const hit = SURFACES.find((s) => s.key === e.key);
        armed = 0;
        if (hit) {
          e.preventDefault();
          latest.current.navigate(latest.current.href(hit.path));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
