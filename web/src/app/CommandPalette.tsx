import { Artwork } from "../ui/Artwork";
import { Dialog } from "@base-ui/react/dialog";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useSearch } from "../api/queries";
import { fmtHours } from "../lib/format";
import { albumPath, artistPath, songPath, useRangeHref } from "../ui/AppLink";
import { usePlayback } from "../player/playback";
import type { SongRef } from "../ui/SongMenu";
import { NAV, SETTINGS } from "./nav";

type Entry = { id: string; group: string; label: string; detail?: string; path: string; art?: { src: string | null; round?: boolean }; song?: SongRef };

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query.trim());
  const search = useSearch(deferred, 5);
  const [, navigate] = useLocation();
  const href = useRangeHref();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const entries = useMemo<Entry[]>(() => {
    const q = deferred.toLowerCase();
    const pages = [...NAV, SETTINGS]
      .filter((n) => !q || n.label.toLowerCase().includes(q))
      .map((n) => ({ id: `page:${n.path}`, group: "Go to", label: n.label, path: n.path }));
    const askEntry = { id: "ask", group: "Ask", label: `Ask: ${deferred}`, path: `/ask?q=${encodeURIComponent(deferred)}` };
    if (!q) return pages;
    if (!search.data) return [...pages, askEntry];
    const { artists, songs, albums } = search.data;
    return [
      ...artists.map((a) => ({
        id: `artist:${a.artist}`,
        group: "Artists",
        label: a.artist,
        detail: fmtHours(a.hours),
        path: artistPath(a.artist),
        art: { src: a.imageUrl, round: true },
      })),
      ...songs.map((s) => ({
        id: `song:${s.songKey}`,
        group: "Songs",
        label: s.name,
        detail: s.artist,
        path: songPath(s.songKey),
        art: { src: s.albumArtUrl },
        song: { uri: s.uri, name: s.name },
      })),
      ...albums.map((a) => ({
        id: `album:${a.artist}|${a.album}`,
        group: "Albums",
        label: a.album,
        detail: a.artist,
        path: albumPath(a.artist, a.album),
        art: { src: a.albumArtUrl },
      })),
      ...pages,
      askEntry,
    ];
  }, [deferred, search.data]);

  useEffect(() => setActive(0), [deferred]);

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };
  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    navigate(href(entry.path));
    close();
  };
  const playback = usePlayback();
  const activeSong = entries[active]?.song;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/20 dark:bg-black/50" />
        <Dialog.Popup className="fixed top-[12vh] left-1/2 z-50 flex max-h-[70vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-overlay shadow-extra-large outline-none">
          <Dialog.Title className="sr-only">Search and go to</Dialog.Title>
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
              } else if (e.key === "Enter" && activeSong && e.shiftKey) {
                e.preventDefault();
                playback.queue(activeSong.uri, activeSong.name);
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(entries[active]);
              }
            }}
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={entries[active] ? `palette-${active}` : undefined}
            placeholder="Search artists, songs, albums or pages"
            className="h-12 w-full border-b-[0.5px] border-border-strong bg-transparent px-4 text-body-base outline-none placeholder:text-tertiary"
          />
          <div id="palette-list" role="listbox" aria-label="Results" className="overflow-y-auto p-1">
            {entries.length === 0 && <p className="px-3 py-6 text-secondary">{search.isFetching ? "Searching" : `Nothing matches “${deferred}”.`}</p>}
            {entries.map((entry, i) => (
              <div key={entry.id}>
                {entry.group !== entries[i - 1]?.group && <p className="px-2.5 pt-2 pb-1 text-caption-lg font-medium text-tertiary">{entry.group}</p>}
                <div
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onPointerMove={() => setActive(i)}
                  onClick={() => go(entry)}
                  className={`flex min-h-9 items-center gap-3 rounded-md px-2.5 py-1 text-body-sm ${i === active ? "bg-component" : ""}`}
                >
                  {entry.art && <Artwork src={entry.art.src} name={entry.label} round={entry.art.round} className="size-8" />}
                  <span className="min-w-0 truncate font-medium">{entry.label}</span>
                  {entry.detail && <span className="ml-auto shrink-0 truncate text-secondary">{entry.detail}</span>}
                </div>
              </div>
            ))}
          </div>
          {activeSong && (
            <p className="flex gap-4 border-t-[0.5px] border-border-strong px-4 py-2 text-caption-lg text-secondary">
              <span>
                <kbd className="kbd">{MOD} ↵</kbd> Play
              </span>
              <span>
                <kbd className="kbd">⇧ ↵</kbd> Add to queue
              </span>
            </p>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
