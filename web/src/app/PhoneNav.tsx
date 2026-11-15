import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { useChat } from "../chat/state";
import { MiniPlayer } from "../player/PlayerBar";
import { AppLink } from "../ui/AppLink";
import { cx } from "../ui/cx";
import { Icon } from "../ui/Icon";
import { ChatCircleTextIcon, DotsThreeIcon, MagnifyingGlassIcon } from "../ui/icons";
import { BACKDROP, focusSheetOnTouch } from "../ui/surfaces";
import { PHONE_MORE, PHONE_TABS } from "./nav";

const TAB = "press relative flex h-full flex-1 items-center justify-center rounded-full text-primary";
const MOVE = "duration-(--dur-move) ease-(--ease-move)";
const MORE = { label: "More", icon: DotsThreeIcon };

/** The tab the route belongs to: a tab's index, the More slot for a page reached from More, or none (an unknown page). */
function useCurrentTab(location: string) {
  const index = PHONE_TABS.findIndex((s) => s.match(location));
  const tab = PHONE_TABS[index];
  if (tab) return { index, surface: tab };
  const more = PHONE_MORE.find((s) => s.match(location));
  return more ? { index: PHONE_TABS.length, surface: more } : { index: -1, surface: MORE };
}

/**
 * Phone: a floating dock over the page. A glass pill holds Home, Plays, Music and More, with the current tab on a soft
 * capsule; the round Chat button sits beside it, the mini player above. Scrolling down collapses the pill to the
 * current tab's icon and moves the mini player between it and Chat. More opens a sheet with search and every other
 * surface. A tab shows its page, so it closes the chat.
 */
export function PhoneNav({ onSearch, onOpenPlayer, collapsed, onExpand, inert }: { onSearch: () => void; onOpenPlayer: () => void; collapsed: boolean; onExpand: () => void; inert: boolean }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const chat = useChat();
  const chatOpen = chat.open && !location.startsWith("/ask");
  const current = useCurrentTab(location);
  const chatButton = useRef<HTMLButtonElement>(null);
  const openedAt = useRef<string | null>(null);
  useEffect(() => {
    if (chatOpen) {
      openedAt.current = location;
      return;
    }
    if (openedAt.current === location) chatButton.current?.focus({ preventScroll: true });
    openedAt.current = null;
  }, [chatOpen, location]);

  return (
    <>
      <div aria-hidden className="edge-blur pointer-events-none fixed inset-x-0 bottom-[calc(-1*env(safe-area-inset-bottom,0px)-40px)] z-10 h-[calc(var(--bottom-chrome)+env(safe-area-inset-bottom,0px)+56px)] in-data-keyboard-open:hidden">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} />
        ))}
      </div>
      <div
        data-dock
        data-collapsed={collapsed || undefined}
        inert={inert}
        className="group/dock absolute right-[calc(var(--gutter)+env(safe-area-inset-right,0px))] bottom-(--dock-bottom) left-[calc(var(--gutter)+env(safe-area-inset-left,0px))] pointer-events-none z-20 h-(--tabbar-h) *:pointer-events-auto [--pill-w:calc(100vw-2*var(--gutter)-env(safe-area-inset-left,0px)-env(safe-area-inset-right,0px)-var(--tabbar-h)-var(--dock-gap))] in-data-keyboard-open:hidden"
      >
        <MiniPlayer
          onOpen={onOpenPlayer}
          className={cx(
            "absolute right-0 bottom-[calc(var(--tabbar-h)+var(--dock-gap))] left-0 h-(--mini-player-h) transition-[left,right,bottom,height]",
            "group-data-collapsed/dock:right-[calc(var(--tabbar-h-collapsed)+var(--dock-gap))] group-data-collapsed/dock:bottom-0 group-data-collapsed/dock:left-[calc(var(--tabbar-h-collapsed)+var(--dock-gap))] group-data-collapsed/dock:h-(--tabbar-h-collapsed)",
            MOVE,
          )}
        />
        <nav
          aria-label="Main"
          className={cx(
            "glass absolute bottom-0 left-0 h-(--tabbar-h) w-(--pill-w) overflow-hidden rounded-full shadow-overlay transition-[width,height]",
            "group-data-collapsed/dock:h-(--tabbar-h-collapsed) group-data-collapsed/dock:w-(--tabbar-h-collapsed)",
            MOVE,
          )}
        >
          <div inert={collapsed} className={cx("absolute bottom-0 left-0 flex h-(--tabbar-h) w-(--pill-w) p-1 transition-opacity group-data-collapsed/dock:opacity-0", MOVE)}>
            {current.index >= 0 && (
              <span
                aria-hidden
                style={{ "--tab": current.index } as CSSProperties}
                className="absolute inset-y-1 left-1 w-[calc((100%-8px)/4)] translate-x-[calc(var(--tab)*100%)] rounded-full bg-fill-active transition-transform duration-(--dur-swap) ease-out"
              />
            )}
            {PHONE_TABS.map((s, i) => {
              const active = i === current.index;
              return (
                <AppLink key={s.id} to={s.path} onClick={chat.close} aria-label={s.label} aria-current={active ? "page" : undefined} className={TAB}>
                  <Icon icon={s.icon} size="lg" fill={active} />
                </AppLink>
              );
            })}
            <button type="button" aria-label="More" aria-haspopup="dialog" aria-current={current.index === PHONE_TABS.length || undefined} onClick={() => setOpen(true)} className={TAB}>
              <Icon icon={DotsThreeIcon} size="lg" />
            </button>
          </div>
          <button
            type="button"
            inert={!collapsed}
            aria-label={`${current.surface.label}, show tabs`}
            onClick={onExpand}
            className={cx("press absolute inset-0 flex items-center justify-center rounded-full text-primary opacity-0 transition-opacity group-data-collapsed/dock:opacity-100", MOVE)}
          >
            <Icon icon={current.surface.icon} size="lg" fill={current.index >= 0 && current.index < PHONE_TABS.length} />
          </button>
        </nav>
        <button
          ref={chatButton}
          type="button"
          aria-label="Chat"
          aria-pressed={chatOpen}
          onClick={chat.toggle}
          className={cx(
            "press absolute right-0 bottom-0 flex size-(--tabbar-h) items-center justify-center rounded-full bg-accent text-on-accent shadow-overlay transition-[width,height,background-color] hover:bg-accent-hover",
            "group-data-collapsed/dock:size-(--tabbar-h-collapsed)",
            MOVE,
          )}
        >
          <Icon icon={ChatCircleTextIcon} size="lg" fill={chatOpen} />
        </button>
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={BACKDROP} />
          <Dialog.Popup ref={sheet} initialFocus={focusSheetOnTouch(sheet)} className="fixed inset-x-0 bottom-0 z-50 max-h-[calc(100dvh-env(safe-area-inset-top)-24px)] overflow-y-auto overscroll-contain rounded-t-[14px] bg-overlay pb-[max(16px,env(safe-area-inset-bottom))] shadow-modal outline-none transition-transform duration-300 ease-(--ease-drawer) data-[ending-style]:translate-y-full data-[ending-style]:duration-200 data-[starting-style]:translate-y-full motion-reduce:transition-opacity motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-y-0 motion-reduce:data-[starting-style]:opacity-0">
            <Dialog.Close aria-label="Close" className="mx-auto flex h-11 w-[88px] items-center justify-center">
              <span className="h-[5px] w-9 rounded-full bg-fill-active" />
            </Dialog.Close>
            <Dialog.Title className="sr-only">More</Dialog.Title>
            <div className="flex flex-col gap-2 px-5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSearch();
                }}
                className="flex h-11 items-center gap-3 rounded-md bg-fill px-3 text-secondary"
              >
                <Icon icon={MagnifyingGlassIcon} />
                Search
              </button>
              <ul className="flex flex-col">
                {PHONE_MORE.map((s) => {
                  const active = s.match(location);
                  return (
                    <li key={s.id}>
                      <AppLink
                        to={s.path}
                        onClick={() => {
                          setOpen(false);
                          chat.close();
                        }}
                        aria-current={active ? "page" : undefined}
                        className={cx("flex h-12 items-center gap-3 rounded-md px-3", active ? "bg-fill text-primary" : "text-primary")}
                      >
                        <Icon icon={s.icon} size="md" fill={active} className="text-secondary" />
                        {s.label}
                      </AppLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
