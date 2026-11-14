import { useLocation } from "wouter";
import { AppLink } from "./AppLink";
import { cx } from "./cx";

export type TabNavItem = { path: string; label: string };

/** Tabs that are links: each tab is its own URL, so it can be shared and opened in a new tab. */
export function TabNav({ items, label }: { items: TabNavItem[]; label: string }) {
  const [location] = useLocation();
  return (
    <nav aria-label={label} className="-mx-(--gutter) overflow-x-auto px-(--gutter) no-scrollbar hairline-b">
      <ul className="flex items-center gap-5">
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
