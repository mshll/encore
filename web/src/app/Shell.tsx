import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocation, useSearchParams } from "wouter";
import { useDesktop } from "../lib/useMedia";
import { showToast } from "../lib/toast";
import { MiniPlayer, PlayerBar } from "../player/PlayerBar";
import { NowPlayingSheet } from "../player/NowPlayingSheet";
import { QueuePanel } from "../player/QueuePanel";
import { Toaster } from "../ui/Toast";
import { TooltipProvider } from "../ui/Tooltip";
import { CommandPalette } from "./CommandPalette";
import { PhoneNav } from "./PhoneNav";
import { Sidebar } from "./Sidebar";

const ScrollContext = createContext<RefObject<HTMLElement | null>>({ current: null });

/** The page panel is the scroll container on every width. Virtualised lists measure against it. */
export const useScrollElement = () => useContext(ScrollContext);

const QueueOpener = createContext<() => void>(() => {});

/** Shows the queue, where a running DJ session lives: the side panel on desktop, the now-playing sheet on a phone. */
export const useOpenQueue = () => useContext(QueueOpener);

const SPOTIFY_NOTICES: Record<string, { message: string; tone: "info" | "problem" }> = {
  connected: { message: "Spotify connected.", tone: "info" },
  denied: { message: "Spotify was not connected: access was declined.", tone: "problem" },
  error: { message: "Spotify could not be connected. Try again from Settings.", tone: "problem" },
};

function useSpotifyNotice() {
  const [params, setParams] = useSearchParams();
  const result = params.get("spotify");
  useEffect(() => {
    if (!result) return;
    const notice = SPOTIFY_NOTICES[result];
    if (notice) showToast(notice.message, notice.tone);
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.delete("spotify");
        return out;
      },
      { replace: true },
    );
  }, [result, setParams]);
}

/** New page: back to the top, focus on the page so a screen reader starts from its title. */
function useRouteReset(main: RefObject<HTMLElement | null>) {
  const [location] = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.scrollTo({ top: 0 });
    main.current?.focus({ preventScroll: true });
  }, [location, main]);
}

/**
 * Desktop: sidebar on the shell ground, the page as an inset panel, the queue as a second panel on the right,
 * the player docked across the bottom. Phone: the page edge to edge, a mini player and the tab bar at the foot.
 */
export function Shell({ children }: { children: ReactNode }) {
  const desktop = useDesktop();
  const main = useRef<HTMLElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  useSpotifyNotice();
  useRouteReset(main);

  return (
    <TooltipProvider delay={500}>
      <Toaster>
        <ScrollContext.Provider value={main}>
          <a
            href="#main"
            className="fixed top-3 left-3 z-[80] -translate-y-[200%] rounded-md bg-overlay px-3 py-2 font-medium shadow-overlay focus-visible:translate-y-0"
          >
            Skip to content
          </a>
          {desktop ? (
            <div
              className="grid h-dvh grid-cols-[var(--sidebar-w)_minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)_var(--player-h)]"
              style={{ ["--bottom-chrome" as string]: "var(--player-h)" }}
            >
              <Sidebar onSearch={() => setPaletteOpen(true)} />
              <main ref={main} id="main" tabIndex={-1} data-crop className="mt-(--inset) overflow-y-auto rounded-xl bg-page shadow-panel outline-none">
                <QueueOpener.Provider value={desktop ? () => setQueueOpen(true) : () => setSheetOpen(true)}>{children}</QueueOpener.Provider>
              </main>
              <div className={queueOpen ? "mt-(--inset) mr-(--inset) ml-(--inset) min-h-0" : "w-(--inset)"}>
                {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
              </div>
              <div className="col-span-3">
                <PlayerBar queueOpen={queueOpen} onToggleQueue={() => setQueueOpen((o) => !o)} />
              </div>
            </div>
          ) : (
            <div className="flex h-dvh flex-col bg-page" style={{ ["--bottom-chrome" as string]: "calc(56px + 64px + env(safe-area-inset-bottom))" }}>
              <main ref={main} id="main" tabIndex={-1} data-crop className="min-h-0 flex-1 overflow-y-auto pt-[env(safe-area-inset-top)] outline-none">
                <QueueOpener.Provider value={desktop ? () => setQueueOpen(true) : () => setSheetOpen(true)}>{children}</QueueOpener.Provider>
              </main>
              <div className="shrink-0 bg-shell pb-[env(safe-area-inset-bottom)]">
                <div className="bg-page">
                  <MiniPlayer onOpen={() => setSheetOpen(true)} />
                </div>
                <PhoneNav onSearch={() => setPaletteOpen(true)} />
              </div>
              <NowPlayingSheet open={sheetOpen} onOpenChange={setSheetOpen} />
            </div>
          )}
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        </ScrollContext.Provider>
      </Toaster>
    </TooltipProvider>
  );
}
