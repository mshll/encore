import { useLocation } from "wouter";
import { usePlayerNow } from "../api/queries";
import { useChat } from "../chat/state";
import { fmtDuration } from "../lib/format";
import { Artwork } from "../ui/Artwork";
import { IconButton } from "../ui/Button";
import { cx } from "../ui/cx";
import { Icon } from "../ui/Icon";
import { ArrowUpRightIcon, ChatCircleTextIcon, PauseIcon, PlayIcon, QueueIcon, ShuffleIcon, SkipForwardIcon } from "../ui/icons";
import { Kbd, MOD_KEY } from "../ui/Kbd";
import { Tooltip } from "../ui/Tooltip";
import { AppLink } from "../ui/AppLink";
import { useTrackLinks } from "./links";
import { openInSpotify, usePlayback } from "./playback";
import { useProgress } from "./progress";

function ProgressLine({ share, className = "h-1 rounded-full bg-fill" }: { share: number; className?: string }) {
  return (
    <span aria-hidden className={cx("relative block overflow-hidden", className)}>
      <span className="absolute inset-0 origin-left bg-primary transition-transform duration-1000 ease-linear motion-reduce:transition-none" style={{ transform: `scaleX(${share})` }} />
    </span>
  );
}

/** Desktop: the docked bar under the page, full width. Track left, controls and progress centre, queue right. */
export function PlayerBar({ queueOpen, onToggleQueue }: { queueOpen: boolean; onToggleQueue: () => void }) {
  const now = usePlayerNow();
  const playback = usePlayback();
  const progress = useProgress(now.data);
  const track = now.data?.track ?? null;
  const playing = Boolean(now.data?.playing);
  const device = now.data?.device?.name;
  const links = useTrackLinks(track?.uri);
  return (
    <section aria-label="Player" className="grid h-(--player-h) grid-cols-[minmax(0,1fr)_minmax(0,320px)_minmax(0,1fr)] items-center gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)_minmax(0,1fr)]">
      <div className="flex min-w-0 items-center gap-3">
        {track ? (
          <>
            {links ? (
              <AppLink to={links.song} tabIndex={-1} aria-label={track.name} className="shrink-0">
                <Artwork src={track.albumArtUrl} kind="song" box={48} />
              </AppLink>
            ) : (
              <Artwork src={track.albumArtUrl} kind="song" box={48} />
            )}
            <div className="flex min-w-0 flex-col">
              {links ? (
                <AppLink to={links.song} className="truncate text-primary hover:underline">
                  {track.name}
                </AppLink>
              ) : (
                <span className="truncate text-primary">{track.name}</span>
              )}
              <span className="-my-1 truncate py-1 text-caption text-secondary">
                {links ? (
                  <AppLink to={links.artist} className="-mx-1 px-1 py-1 hover:text-primary hover:underline">
                    {track.artist}
                  </AppLink>
                ) : (
                  track.artist
                )}
                {device && <span className="text-tertiary"> · {device}</span>}
              </span>
            </div>
          </>
        ) : (
          <span className="text-secondary">{now.isError ? "Spotify player unavailable" : "Nothing playing"}</span>
        )}
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-2">
          <Tooltip label={now.data?.shuffle ? "Shuffle on" : "Shuffle off"}>
            <IconButton
              icon={ShuffleIcon}
              label="Shuffle"
              size="sm"
              aria-pressed={Boolean(now.data?.shuffle)}
              disabled={!track}
              onClick={() => playback.shuffle(!now.data?.shuffle)}
            />
          </Tooltip>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            disabled={!track}
            onClick={() => (playing ? playback.pause() : playback.resume())}
            className="press touch-target flex size-9 items-center justify-center rounded-full bg-fill-inverted text-inverted transition-colors duration-150 hover:bg-fill-inverted-hover disabled:opacity-40"
          >
            <Icon icon={playing ? PauseIcon : PlayIcon} size="md" fill />
          </button>
          <Tooltip label="Next">
            <IconButton icon={SkipForwardIcon} label="Next" size="sm" fill disabled={!track} onClick={() => playback.next()} />
          </Tooltip>
        </div>
        <div className="flex w-full items-center gap-2 text-label text-tertiary tabular">
          <span className="w-9 text-right">{track ? fmtDuration(progress.ms) : ""}</span>
          <ProgressLine share={track ? progress.share : 0} className="h-1 flex-1 rounded-full bg-fill" />
          <span className="w-9">{track ? fmtDuration(track.durationMs) : ""}</span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        {track && (
          <Tooltip label="Open in Spotify">
            <a href={openInSpotify(track.uri)} target="_blank" rel="noreferrer" aria-label="Open in Spotify" className="press touch-target flex size-(--control-h) items-center justify-center rounded-md text-secondary transition-colors hover:bg-fill-hover hover:text-primary">
              <Icon icon={ArrowUpRightIcon} size="md" />
            </a>
          </Tooltip>
        )}
        <ChatToggle />
        <Tooltip label={queueOpen ? "Hide queue" : "Queue"}>
          <IconButton icon={QueueIcon} label="Queue" aria-pressed={queueOpen} className={queueOpen ? "bg-fill" : ""} onClick={onToggleQueue} />
        </Tooltip>
      </div>
    </section>
  );
}

/** The chat's way in on desktop, beside the queue it shares a slot with. */
function ChatToggle() {
  const chat = useChat();
  const [location] = useLocation();
  const open = chat.open && !location.startsWith("/ask");
  return (
    <Tooltip
      label={
        <span className="flex items-center gap-1.5">
          {open ? "Hide chat" : "Chat"}
          <Kbd className="bg-fill-on-standout text-on-standout-secondary">{`${MOD_KEY} J`}</Kbd>
        </span>
      }
    >
      <IconButton icon={ChatCircleTextIcon} label="Chat" aria-pressed={open} className={open ? "bg-fill" : ""} onClick={chat.toggle} />
    </Tooltip>
  );
}

/**
 * Phone: a glass pill in the dock while something plays: above the tab bar, or between the collapsed tab and Chat.
 * Tapping it opens the full player.
 */
export function MiniPlayer({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const now = usePlayerNow();
  const playback = usePlayback();
  const track = now.data?.track;
  if (!track) return null;
  const playing = Boolean(now.data?.playing);
  return (
    <section aria-label="Player" data-mini-player className={cx("glass flex items-center gap-1 overflow-hidden rounded-full pr-1.5 pl-2 shadow-overlay group-data-collapsed/dock:pl-1.5", className)}>
      <button type="button" onClick={onOpen} className="press flex h-full min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Open player: ${track.name} by ${track.artist}`}>
        <span className="size-10 shrink-0 transition-[width,height] duration-(--dur-move) ease-(--ease-move) group-data-collapsed/dock:size-9">
          <Artwork src={track.albumArtUrl} kind="song" box="fill" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-primary">{track.name}</span>
          <span className="truncate text-caption text-on-glass-secondary group-data-collapsed/dock:hidden">{track.artist}</span>
        </span>
      </button>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => (playing ? playback.pause() : playback.resume())}
        className="press flex size-11 shrink-0 items-center justify-center rounded-full text-primary transition-colors duration-(--dur-hover) hover:bg-fill-hover"
      >
        <Icon icon={playing ? PauseIcon : PlayIcon} size="md" fill />
      </button>
    </section>
  );
}

export { ProgressLine };
