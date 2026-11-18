import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocation, useSearchParams } from "wouter";
import { ChatProvider } from "../chat/ChatProvider";
import { useAi } from "../lib/ai";
import { useDesktop } from "../lib/useMedia";
import { showToast } from "../lib/toast";
import { PlayerBar } from "../player/PlayerBar";
import { Toaster } from "../ui/Toast";
import { useDockCollapse } from "./dock";
import { useSoftKeyboard } from "./keyboard";
import { PhoneNav } from "./PhoneNav";
import { cx } from "../ui/cx";
import { useShortcuts } from "./shortcuts";
import { Sidebar } from "./Sidebar";

const CommandPalette = lazy(() => import("./CommandPalette").then((m) => ({ default: m.CommandPalette })));
const QueuePanel = lazy(() => import("../player/QueuePanel").then((m) => ({ default: m.QueuePanel })));
const ChatPanel = lazy(() => import("../chat/ChatPanel").then((m) => ({ default: m.ChatPanel })));
const NowPlayingSheet = lazy(() => import("../player/NowPlayingSheet").then((m) => ({ default: m.NowPlayingSheet })));

/** True from the first time `open` is true: an overlay loads on first use, then stays mounted so it can animate closed. */
function useOnceOpen(open: boolean) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened;
}

const ScrollContext = createContext<RefObject<HTMLElement | null>>({ current: null });

/** The page panel is the scroll container on every width. Virtualised lists measure against it. */
export const useScrollElement = () => useContext(ScrollContext);

const QueueOpener = createContext<() => void>(() => {});

/** Shows the queue, where a running DJ session lives: the side panel on desktop, the now-playing sheet on a phone. */
export const useOpenQueue = () => useContext(QueueOpener);

const SPOTIFY_NOTICES: Record<string, { message: string; tone: "info" | "problem" }> = {
  connected: { message: "Spotify connected.", tone: "info" },
  denied: { message: "Spotify was not connected: access was declined.", tone: "problem" },
  error: { message: "Spotify could not be connected. Try again.", tone: "problem" },
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

type Side = "queue" | "chat" | null;

const CHAT_OPEN = "encore-chat-open";

/** On desktop the chat opens again where it was left; a phone starts on the page. */
function initialSide(): Side {
  try {
    return window.matchMedia("(min-width: 768px)").matches && localStorage.getItem(CHAT_OPEN) === "1" ? "chat" : null;
  } catch {
    return null;
  }
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
 * Desktop: sidebar on the shell ground, the page as an inset panel, the queue or the chat as a second panel on the
 * right (one at a time), the player docked across the bottom. Phone: the page edge to edge under a floating dock (tab
 * bar, Chat, mini player); the chat is a full-screen sheet over both.
 */
export function Shell({ children }: { children: ReactNode }) {
  const desktop = useDesktop();
  const main = useRef<HTMLElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [side, setSide] = useState<Side>(initialSide);
  const [location] = useLocation();
  const queueOpen = side === "queue";
  const ai = useAi();
  const chatShown = side === "chat" && ai.configured && !location.startsWith("/chat");
  const setQueueOpen = useCallback((open: boolean) => setSide((s) => (open ? "queue" : s === "queue" ? null : s)), []);
  const setChatOpen = useCallback((open: boolean) => setSide((s) => (open ? "chat" : s === "chat" ? null : s)), []);
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_OPEN, side === "chat" ? "1" : "0");
    } catch {
      // Blocked storage: the chat starts closed next time.
    }
  }, [side]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const paletteLoaded = useOnceOpen(paletteOpen);
  const sheetLoaded = useOnceOpen(sheetOpen);
  useSpotifyNotice();
  useRouteReset(main);
  useSoftKeyboard(!desktop, main);
  const dock = useDockCollapse(main, !desktop);
  useShortcuts(useCallback(() => setPaletteOpen((o) => !o), []));

  return (
    <Toaster>
      <ScrollContext.Provider value={main}>
        <ChatProvider open={side === "chat"} onOpenChange={setChatOpen}>
        <a
          href="#main"
          className="fixed top-3 left-3 z-[80] -translate-y-[200%] rounded-md bg-overlay px-3 py-2 font-medium shadow-overlay focus-visible:translate-y-0"
        >
          Skip to content
        </a>
        {desktop ? (
          <div className="grid h-dvh grid-cols-[var(--sidebar-w)_minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)_var(--player-h)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
            <Sidebar onSearch={() => setPaletteOpen(true)} />
            <main ref={main} id="main" tabIndex={-1} data-crop className="relative mt-(--inset) overflow-y-auto overscroll-contain rounded-xl bg-page shadow-panel outline-none">
              <QueueOpener.Provider value={desktop ? () => setQueueOpen(true) : () => setSheetOpen(true)}>{children}</QueueOpener.Provider>
            </main>
            <div className={queueOpen || chatShown ? "mt-(--inset) mr-(--inset) ml-(--inset) min-h-0" : "w-(--inset)"}>
              <Suspense fallback={null}>
                {queueOpen && <QueuePanel onClose={() => setQueueOpen(false)} />}
                {chatShown && <ChatPanel place="dock" />}
              </Suspense>
            </div>
            <div className="col-span-3">
              <PlayerBar queueOpen={queueOpen} onToggleQueue={() => setQueueOpen(!queueOpen)} />
            </div>
          </div>
        ) : (
          <div className="group/shell relative top-(--app-top,0px) h-(--app-h,100dvh) overflow-hidden bg-page">
            {/* Under the chat sheet the page is out of reach; it hides once the sheet has slid over it, and shows while the sheet is dragged down. */}
            <main
              ref={main}
              id="main"
              tabIndex={-1}
              data-crop
              inert={chatShown}
              className={cx(
                "relative h-full overflow-y-auto overscroll-contain pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-(--dock-h) pl-[env(safe-area-inset-left)] outline-none",
                chatShown &&
                  "invisible transition-[visibility] delay-(--dur-modal) group-has-data-chat-dragging/shell:visible group-has-data-chat-dragging/shell:delay-0",
              )}
            >
              <QueueOpener.Provider value={desktop ? () => setQueueOpen(true) : () => setSheetOpen(true)}>{children}</QueueOpener.Provider>
            </main>
            <PhoneNav onSearch={() => setPaletteOpen(true)} onOpenPlayer={() => setSheetOpen(true)} collapsed={dock.collapsed} onExpand={dock.expand} inert={chatShown} />
            {chatShown && (
              <Suspense fallback={null}>
                <ChatPanel place="sheet" />
              </Suspense>
            )}
            {sheetLoaded && (
              <Suspense fallback={null}>
                <NowPlayingSheet open={sheetOpen} onOpenChange={setSheetOpen} />
              </Suspense>
            )}
          </div>
        )}
        {paletteLoaded && (
          <Suspense fallback={null}>
            <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
          </Suspense>
        )}
        </ChatProvider>
      </ScrollContext.Provider>
    </Toaster>
  );
}
