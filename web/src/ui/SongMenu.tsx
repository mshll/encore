import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { openInSpotify, usePlayback } from "../player/playback";
import { useStartSession } from "../player/session";
import { Icon, MoreHorizontalIcon, PlayIcon, Radio01Icon } from "./Icon";

export type SongRef = { uri: string; name: string };
export type ExtraAction = { label: string; onSelect: () => void; danger?: boolean };

const POPUP = "popup min-w-48 p-1 outline-none";

function Items({ song, Item, LinkItem, extra = [] }: { song: SongRef; Item: typeof Menu.Item; LinkItem: typeof Menu.LinkItem; extra?: ExtraAction[] }) {
  const playback = usePlayback();
  return (
    <>
      <Item className="menu-item" onClick={() => playback.play([song.uri])}>
        Play
      </Item>
      <Item className="menu-item" onClick={() => playback.queue(song.uri, song.name)}>
        Add to queue
      </Item>
      <LinkItem className="menu-item" href={openInSpotify(song.uri)} target="_blank" rel="noreferrer">
        Open in Spotify
      </LinkItem>
      {extra.length > 0 && <div role="separator" className="mx-2 my-1 h-px bg-border-default" />}
      {extra.map((a) => (
        <Item key={a.label} className={`menu-item ${a.danger ? "text-danger" : ""}`} onClick={a.onSelect}>
          {a.label}
        </Item>
      ))}
    </>
  );
}

export function SongMenu({ song, className = "", extra }: { song: SongRef; className?: string; extra?: ExtraAction[] }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={`btn btn-icon btn-transparent shrink-0 ${className}`} aria-label={`Actions for ${song.name}`}>
        <Icon icon={MoreHorizontalIcon} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Menu.Popup className={POPUP}>
            <Items song={song} Item={Menu.Item} LinkItem={Menu.LinkItem} extra={extra} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function SongContext({
  song,
  children,
  className = "",
  element = "li",
  extra,
}: {
  song: SongRef;
  children: ReactNode;
  className?: string;
  element?: "li" | "div";
  extra?: ExtraAction[];
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={element === "li" ? <li /> : <div />} className={className}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50">
          <ContextMenu.Popup className={POPUP}>
            <Items song={song} Item={ContextMenu.Item} LinkItem={ContextMenu.LinkItem} extra={extra} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function PlayButtons({ uris, queue }: { uris: string[]; queue?: SongRef }) {
  const playback = usePlayback();
  if (uris.length === 0) return null;
  return (
    <>
      <button type="button" className="btn btn-accent" onClick={() => playback.play(uris)}>
        <Icon icon={PlayIcon} size={16} />
        Play
      </button>
      {queue && (
        <>
          <button type="button" className="btn btn-secondary" onClick={() => playback.queue(queue.uri, queue.name)}>
            Add to queue
          </button>
          <a className="btn btn-secondary" href={openInSpotify(queue.uri)} target="_blank" rel="noreferrer">
            Open in Spotify
          </a>
        </>
      )}
    </>
  );
}

export function StartSessionButton({ uris, className = "" }: { uris: string[]; className?: string }) {
  const { start, busy } = useStartSession();
  if (uris.length === 0) return null;
  return (
    <button type="button" className={`btn btn-secondary ${className}`} disabled={busy} onClick={() => start(uris)}>
      <Icon icon={Radio01Icon} size={16} />
      {busy ? "Starting" : "Start a session"}
    </button>
  );
}
