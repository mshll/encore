import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import type { CSSProperties, ReactNode } from "react";
import { useLocation } from "wouter";
import { openInSpotify, usePlayback } from "../player/playback";
import { iconButtonClass } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { ArrowUpRightIcon, DotsThreeIcon, PlayIcon, QueueIcon, VinylRecordIcon, MusicNotesIcon } from "./icons";
import { MENU_ITEM, POPUP } from "./surfaces";
import { artistPath, songPath } from "../app/paths";

export type SongRef = { uri: string; name: string; songKey?: string | null; artist?: string | null };

function Items({ song, M }: { song: SongRef; M: typeof Menu | typeof ContextMenu }) {
  const playback = usePlayback();
  const [, navigate] = useLocation();
  return (
    <>
      <M.Item className={MENU_ITEM} onClick={() => playback.play([song.uri])}>
        <Icon icon={PlayIcon} className="text-secondary" />
        Play
      </M.Item>
      <M.Item className={MENU_ITEM} onClick={() => playback.queue(song.uri, song.name)}>
        <Icon icon={QueueIcon} className="text-secondary" />
        Add to queue
      </M.Item>
      <M.Separator className="mx-1 my-1 h-px bg-line" />
      {song.songKey && (
        <M.Item className={MENU_ITEM} onClick={() => navigate(songPath(song.songKey!))}>
          <Icon icon={MusicNotesIcon} className="text-secondary" />
          Go to song
        </M.Item>
      )}
      {song.artist && (
        <M.Item className={MENU_ITEM} onClick={() => navigate(artistPath(song.artist!))}>
          <Icon icon={VinylRecordIcon} className="text-secondary" />
          Go to artist
        </M.Item>
      )}
      <M.LinkItem className={MENU_ITEM} href={openInSpotify(song.uri)} target="_blank" rel="noreferrer">
        <Icon icon={ArrowUpRightIcon} className="text-secondary" />
        Open in Spotify
      </M.LinkItem>
    </>
  );
}

/** The row menu for a song. Every action in it is a user action; nothing plays on its own. */
export function SongMenu({ song, className }: { song: SongRef; className?: string }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={iconButtonClass({ size: "sm", className })} aria-label={`More for ${song.name}`}>
        <Icon icon={DotsThreeIcon} size="md" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} className="z-50">
          <Menu.Popup className={cx(POPUP, "min-w-52 p-1")}>
            <Items song={song} M={Menu} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Right-click on a song row opens the same menu. */
export function SongContext({
  song,
  children,
  className,
  style,
  render = "div",
}: {
  song: SongRef;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  render?: "div" | "li";
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={render === "li" ? <li /> : <div />} className={className} style={style}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50">
          <ContextMenu.Popup className={cx(POPUP, "min-w-52 p-1")}>
            <Items song={song} M={ContextMenu} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
