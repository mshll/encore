import { Menu, MenuContent, MenuContextTrigger, MenuTrigger } from "@ui-sdk/react/menu";
import type { CSSProperties, ReactNode } from "react";
import { useLocation } from "wouter";
import { openInSpotify, usePlayback } from "../player/playback";
import { iconButtonClass } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { ArrowUpRightIcon, DotsThreeIcon, MicrophoneStageIcon, MusicNoteIcon, PlayIcon, QueueIcon } from "./icons";
import { MenuItem, MenuLinkItem, MenuSeparator } from "./Menu";
import { LAYER, POPUP } from "./surfaces";
import { artistPath, songPath } from "../app/paths";

export type SongRef = { uri: string; name: string; songKey?: string | null; artist?: string | null };

function Items({ song }: { song: SongRef }) {
  const playback = usePlayback();
  const [, navigate] = useLocation();
  return (
    <>
      <MenuItem icon={PlayIcon} onClick={() => playback.play([song.uri])}>
        Play
      </MenuItem>
      <MenuItem icon={QueueIcon} onClick={() => playback.queue(song.uri, song.name)}>
        Add to queue
      </MenuItem>
      <MenuSeparator />
      {song.songKey && (
        <MenuItem icon={MusicNoteIcon} onClick={() => navigate(songPath(song.songKey!))}>
          Go to song
        </MenuItem>
      )}
      {song.artist && (
        <MenuItem icon={MicrophoneStageIcon} onClick={() => navigate(artistPath(song.artist!))}>
          Go to artist
        </MenuItem>
      )}
      <MenuLinkItem icon={ArrowUpRightIcon} href={openInSpotify(song.uri)} target="_blank" rel="noreferrer">
        Open in Spotify
      </MenuLinkItem>
    </>
  );
}

/** The row menu for a song. Every action in it is a user action; nothing plays on its own. */
export function SongMenu({ song, className }: { song: SongRef; className?: string }) {
  return (
    <Menu>
      <MenuTrigger className={iconButtonClass({ size: "sm", className })} aria-label={`More for ${song.name}`}>
        <Icon icon={DotsThreeIcon} size="md" />
      </MenuTrigger>
      <MenuContent container={LAYER} side="bottom" align="end" sideOffset={4} collisionPadding={8} className={cx(POPUP, "min-w-52 p-1")}>
        <Items song={song} />
      </MenuContent>
    </Menu>
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
    <Menu>
      <MenuContextTrigger render={render === "li" ? <li /> : <div />} className={className} style={style}>
        {children}
      </MenuContextTrigger>
      {/* Opens with its first item under the pointer, not below it. */}
      <MenuContent container={LAYER} sideOffset={-5} alignOffset={2} collisionPadding={8} className={cx(POPUP, "min-w-52 p-1")}>
        <Items song={song} />
      </MenuContent>
    </Menu>
  );
}
