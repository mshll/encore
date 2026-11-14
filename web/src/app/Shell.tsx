import { Drawer } from "@base-ui/react/drawer";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useSearchParams } from "wouter";
import { AppLink } from "../ui/AppLink";
import { Lockup } from "../ui/Brand";
import { Cancel01Icon, Icon, MoreHorizontalIcon, Search01Icon } from "../ui/Icon";
import { CommandPalette } from "./CommandPalette";
import { NAV, SETTINGS, TAB_PATHS, type NavItem } from "./nav";

function SidebarLink({ item, location }: { item: NavItem; location: string }) {
  const active = item.match(location);
  return (
    <AppLink
      to={item.path}
      aria-current={active ? "page" : undefined}
      className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-body-base font-medium transition-colors duration-150 ${
        active ? "bg-nav-selected text-primary" : "text-secondary hover-fine:bg-transparent-hover hover-fine:text-primary"
      }`}
    >
      <Icon icon={item.icon} className={active ? "text-primary" : "text-tertiary"} />
      {item.label}
    </AppLink>
  );
}

function Sidebar({ location, onSearch }: { location: string; onSearch: () => void }) {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 px-3 py-4 md:flex">
      <AppLink to="/" aria-label="encore, overview" className="flex h-9 items-center px-2.5">
        <Lockup />
      </AppLink>
      <button
        type="button"
        onClick={onSearch}
        className="flex h-9 w-full items-center gap-2.5 rounded-lg bg-raised px-2.5 text-left text-body-base text-secondary transition-colors duration-150 hover-fine:bg-raised-hover"
      >
        <Icon icon={Search01Icon} className="text-tertiary" />
        <span className="flex-1">Search</span>
        <span className="flex items-center gap-0.5">
          <kbd className="kbd">{isMac ? "⌘" : "Ctrl"}</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      </button>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5">
        {NAV.map((item) => (
          <SidebarLink key={item.path} item={item} location={location} />
        ))}
      </nav>
      <SidebarLink item={SETTINGS} location={location} />
    </aside>
  );
}

function TabBar({ location }: { location: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = TAB_PATHS.map((p) => NAV.find((n) => n.path === p)!);
  const more = [...NAV.filter((n) => !TAB_PATHS.includes(n.path)), SETTINGS];
  const moreActive = more.some((m) => m.match(location));
  const tabClass = (active: boolean) =>
    `press flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-caption-base font-medium ${active ? "text-primary" : "text-tertiary"}`;
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t-[0.5px] border-border-default bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="flex h-14 w-full px-[max(4px,env(safe-area-inset-left))]">
          {tabs.map((item) => {
            const active = item.match(location);
            return (
              <AppLink key={item.path} to={item.path} aria-current={active ? "page" : undefined} className={tabClass(active)}>
                <Icon icon={item.icon} />
                {item.label}
              </AppLink>
            );
          })}
          <button type="button" className={tabClass(moreActive)} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
            <Icon icon={MoreHorizontalIcon} />
            More
          </button>
        </div>
      </nav>
      <Drawer.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Drawer.Portal>
          <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/25 transition-opacity duration-300 ease-(--ease-drawer) data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/60" />
          <Drawer.Viewport className="fixed inset-0 z-50 flex items-end">
            <Drawer.Popup className="w-full rounded-t-3xl bg-overlay pb-[max(12px,env(safe-area-inset-bottom))] shadow-extra-large outline-none transition-transform duration-300 ease-(--ease-drawer) [transform:translateY(var(--drawer-swipe-movement-y,0))] data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)]">
              <Drawer.Content className="flex flex-col px-2 pt-2">
                <div aria-hidden className="mx-auto mb-2 h-1 w-9 rounded-full bg-component-active" />
                <Drawer.Title className="sr-only">More</Drawer.Title>
                {more.map((item) => (
                  <AppLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMoreOpen(false)}
                    aria-current={item.match(location) ? "page" : undefined}
                    className={`flex h-12 items-center gap-3 rounded-lg px-4 text-body-lg font-medium text-primary ${item.match(location) ? "bg-nav-selected" : ""}`}
                  >
                    <Icon icon={item.icon} className="text-secondary" />
                    {item.label}
                  </AppLink>
                ))}
              </Drawer.Content>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

const SPOTIFY_NOTICES: Record<string, string> = {
  connected: "Spotify connected.",
  denied: "Spotify was not connected: access was declined.",
  error: "Spotify could not be connected. Try again from Settings.",
};

function SpotifyNotice() {
  const [params, setParams] = useSearchParams();
  const [message, setMessage] = useState<string | null>(null);
  const result = params.get("spotify");
  useEffect(() => {
    if (!result) return;
    setMessage(SPOTIFY_NOTICES[result] ?? null);
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.delete("spotify");
        return out;
      },
      { replace: true },
    );
  }, [result, setParams]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-50 flex items-center justify-between gap-3 rounded-xl bg-standout px-4 py-3 text-on-standout shadow-large transition-[opacity,transform] duration-200 ease-(--ease-out-quint) starting:translate-y-2 starting:opacity-0 md:right-6 md:bottom-6 md:left-auto md:w-96"
    >
      <span>{message}</span>
      <button
        type="button"
        className="btn btn-icon -mr-2 [--btn-bg:transparent] [--btn-fg:var(--fg-on-standout)]"
        aria-label="Dismiss"
        onClick={() => setMessage(null)}
      >
        <Icon icon={Cancel01Icon} />
      </button>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="fixed top-3 left-3 z-[60] -translate-y-[200%] rounded-lg bg-component-on-sunken px-3 py-2 text-body-sm font-medium opacity-0 shadow-extra-large transition-[translate,opacity] focus-visible:translate-y-0 focus-visible:opacity-100"
      >
        Skip to content
      </a>
      <Sidebar location={location} onSearch={() => setPaletteOpen(true)} />
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 flex-1 bg-canvas pb-[calc(56px+env(safe-area-inset-bottom))] outline-none md:my-2 md:mr-2 md:min-h-[calc(100dvh-16px)] md:rounded-2xl md:pb-0 md:shadow-border"
      >
        {children}
      </main>
      <TabBar location={location} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <SpotifyNotice />
    </div>
  );
}
