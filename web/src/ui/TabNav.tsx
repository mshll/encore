import { useLayoutEffect, useRef } from "react";
import { useLocation } from "wouter";
import { AppLink } from "./AppLink";
import { cx } from "./cx";

export type TabNavItem = { path: string; label: string };

/** Tabs that are links: each tab is its own URL, so it can be shared and opened in a new tab. Scrolls sideways when they do not fit. */
export function TabNav({ items, label }: { items: TabNavItem[]; label: string }) {
  const [location] = useLocation();
  const strip = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = strip.current;
    const tab = nav?.querySelector('[aria-current="page"]');
    if (!nav || !tab) return;
    const box = nav.getBoundingClientRect();
    const at = tab.getBoundingClientRect();
    if (at.left < box.left || at.right > box.right) nav.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
  }, [location]);
  return (
    <nav ref={strip} aria-label={label} className="-mx-(--gutter) overflow-x-auto overscroll-x-contain px-(--gutter) no-scrollbar hairline-b">
      <ul className="flex w-max items-center gap-5">
        {items.map((item) => {
          const active = location === item.path;
          return (
            <li key={item.path}>
              <AppLink
                to={item.path}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex h-10 items-center text-body-sm font-medium whitespace-nowrap transition-colors duration-150",
                  active ? "text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-fill-inverted" : "text-secondary hover:text-primary",
                )}
              >
                {item.label}
              </AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
