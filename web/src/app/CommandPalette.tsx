import { Dialog, DialogBackdrop, DialogClose, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useSearch } from "../api/queries";
import { useChat } from "../chat/state";
import { fmtHours } from "../lib/format";
import { usePlayback } from "../player/playback";
import { useRangeHref } from "../ui/AppLink";
import { Artwork, type ArtKind } from "../ui/Artwork";
import { cx } from "../ui/cx";
import { Icon, type IconGlyph } from "../ui/Icon";
import { ChatCircleTextIcon, MagnifyingGlassIcon } from "../ui/icons";
import { Kbd, MOD_KEY } from "../ui/Kbd";
import { BACKDROP, LAYER } from "../ui/surfaces";
import { SURFACES } from "./nav";
import { albumPath, artistPath, songPath } from "./paths";

type Entry = {
  id: string;
  group: string;
  label: string;
  detail?: string;
  path: string;
  icon?: IconGlyph;
  keys?: string[];
  art?: { src: string | null; kind: ArtKind };
  song?: { uri: string; name: string };
  /** Sent to Claude in a new chat instead of going to `path`. */
  ask?: string;
};

/** Search and go: surfaces, then artists, songs and albums from your history, then a question for Ask. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query.trim());
  const search = useSearch(deferred, 5);
  const [, navigate] = useLocation();
  const chat = useChat();
  const href = useRangeHref();
  const playback = usePlayback();
  const listRef = useRef<HTMLDivElement>(null);
  const entries = useMemo<Entry[]>(() => {
    const q = deferred.toLowerCase();
    const pages: Entry[] = SURFACES.filter((s) => !q || s.label.toLowerCase().includes(q)).map((s) => ({
      id: `page:${s.path}`,
      group: "Go to",
      label: s.label,
      path: s.path,
      icon: s.icon,
      keys: s.key ? ["G", s.key.toUpperCase()] : undefined,
    }));
    if (!q) return pages;
    const ask: Entry = { id: "ask", group: "Ask", label: `Ask “${deferred}”`, path: "/ask", icon: ChatCircleTextIcon, ask: deferred };
    const found = search.data;
    if (!found) return [...pages, ask];
    return [
      ...found.artists.map((a) => ({ id: `artist:${a.artist}`, group: "Artists", label: a.artist, detail: fmtHours(a.hours), path: artistPath(a.artist), art: { src: a.imageUrl, kind: "artist" as const } })),
      ...found.songs.map((s) => ({
        id: `song:${s.songKey}`,
        group: "Songs",
        label: s.name,
        detail: s.artist,
        path: songPath(s.songKey),
        art: { src: s.albumArtUrl, kind: "song" as const },
        song: { uri: s.uri, name: s.name },
      })),
      ...found.albums.map((a) => ({ id: `album:${a.artist}|${a.album}`, group: "Albums", label: a.album, detail: a.artist, path: albumPath(a.artist, a.album), art: { src: a.albumArtUrl, kind: "album" as const } })),
      ...pages,
      ask,
    ];
  }, [deferred, search.data]);

  useEffect(() => setActive(0), [deferred]);
  useEffect(() => {
    listRef.current?.querySelector(`#palette-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };
  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    if (entry.ask) chat.show({ thread: null, mode: "ask", send: entry.ask });
    else navigate(href(entry.path));
    close();
  };
  const activeSong = entries[active]?.song;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())} container={LAYER}>
      <DialogBackdrop className={BACKDROP} />
      <DialogContent className="fixed inset-x-0 top-(--app-top,0px) bottom-(--keyboard-inset,0px) z-50 flex flex-col overflow-hidden bg-overlay outline-none transition-[opacity,transform] duration-150 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 md:inset-auto md:top-[12vh] md:left-1/2 md:max-h-[min(560px,76dvh)] md:w-[min(640px,calc(100vw-32px))] md:-translate-x-1/2 md:rounded-xl md:shadow-modal md:data-[ending-style]:scale-[0.98] md:data-[starting-style]:scale-[0.98] motion-reduce:md:data-[ending-style]:scale-100 motion-reduce:md:data-[starting-style]:scale-100">
        <DialogTitle className="sr-only">Search and go to</DialogTitle>
        <div className="flex h-12 shrink-0 items-center gap-2.5 px-4 hairline-b phone:h-14 phone:pt-[env(safe-area-inset-top)]">
          <Icon icon={MagnifyingGlassIcon} className="text-tertiary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, entries.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && activeSong && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                playback.play([activeSong.uri]);
                close();
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(entries[active]);
              }
            }}
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={entries[active] ? `palette-${active}` : undefined}
            aria-label="Search"
            placeholder="Search artists, songs, albums or pages…"
            enterKeyHint="go"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-tertiary"
          />
          <DialogClose className="text-body-sm text-secondary md:hidden">Cancel</DialogClose>
        </div>
        <div ref={listRef} id="palette-list" role="listbox" aria-label="Results" tabIndex={-1} data-crop className="flex-1 overflow-y-auto overscroll-contain p-1.5">
          {entries.length === 0 && <p className="px-3 py-8 text-center text-secondary">{search.isFetching ? "Searching…" : `Nothing matches “${deferred}”.`}</p>}
          {entries.map((entry, i) => (
            <div key={entry.id}>
              {entry.group !== entries[i - 1]?.group && <p className="px-2.5 pt-2.5 pb-1 text-caption text-tertiary">{entry.group}</p>}
              <div
                id={`palette-${i}`}
                role="option"
                aria-selected={i === active}
                onPointerMove={() => setActive(i)}
                onClick={() => go(entry)}
                className={cx("flex min-h-9 items-center gap-3 rounded-md px-2.5 py-1 phone:min-h-12", i === active && "bg-fill")}
              >
                {entry.art ? (
                  <Artwork src={entry.art.src} kind={entry.art.kind} box={24} />
                ) : entry.icon ? (
                  <Icon icon={entry.icon} className="text-secondary" />
                ) : null}
                <span className="min-w-0 truncate">{entry.label}</span>
                {entry.detail && <span className="ml-auto shrink-0 truncate pl-3 text-caption text-secondary">{entry.detail}</span>}
                {entry.keys && (
                  <span className="ml-auto flex gap-0.5">
                    {entry.keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-4 px-4 py-2 text-caption text-secondary hairline-t pointer-coarse:hidden">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> Navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> Open
          </span>
          {activeSong && (
            <span className="flex items-center gap-1.5">
              <Kbd>{MOD_KEY}</Kbd>
              <Kbd>↵</Kbd> Play
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>esc</Kbd> Close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
