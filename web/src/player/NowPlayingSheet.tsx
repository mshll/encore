import { Drawer, DrawerBackdrop, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@ui-sdk/react/drawer";
import { useEffect } from "react";
import { usePlayerNow } from "../api/queries";
import { fmtDuration } from "../lib/format";
import { Artwork } from "../ui/Artwork";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { PauseIcon, PlayIcon, ShuffleIcon, SkipForwardIcon } from "../ui/icons";
import { LAYER, SHEET_BACKDROP, sheetFocus } from "../ui/surfaces";
import { ProgressLine } from "./PlayerBar";
import { AppLink } from "../ui/AppLink";
import { useTrackLinks } from "./links";
import { usePlayback } from "./playback";
import { useProgress } from "./progress";
import { QueueContent } from "./QueuePanel";

/** Phone: the full player as a bottom sheet. Grab handle closes it; the queue sits under the controls. */
export function NowPlayingSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const now = usePlayerNow();
  const playback = usePlayback();
  const progress = useProgress(now.data);
  const track = now.data?.track;
  const links = useTrackLinks(track?.uri);
  useEffect(() => {
    if (open && !track) onOpenChange(false);
  }, [open, track, onOpenChange]);
  if (!track) return null;
  const playing = Boolean(now.data?.playing);
  return (
    <Drawer open={open} onOpenChange={onOpenChange} container={LAYER}>
      <DrawerBackdrop className={SHEET_BACKDROP} />
      <DrawerContent initialFocus={sheetFocus()} className="flex max-h-[calc(100dvh-env(safe-area-inset-top)-24px)] w-full flex-col rounded-t-[14px] bg-overlay shadow-modal outline-none">
        <DrawerClose aria-label="Close" className="mx-auto flex h-11 w-[88px] shrink-0 items-center justify-center">
          <span className="h-[5px] w-9 rounded-full bg-fill-active" />
        </DrawerClose>
        <div data-crop className="flex flex-col gap-6 overflow-y-auto overscroll-contain px-5 pb-[max(24px,env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-5">
            <Artwork src={track.albumArtUrl} kind="song" box="fill" className="mx-auto max-w-[320px] rounded-lg" />
            <div className="flex flex-col">
              <DrawerTitle className="text-heading font-medium text-balance">
                {links ? (
                  <AppLink to={links.song} onClick={() => onOpenChange(false)}>
                    {track.name}
                  </AppLink>
                ) : (
                  track.name
                )}
              </DrawerTitle>
              <DrawerDescription className="text-secondary">
                {links ? (
                  <AppLink to={links.artist} onClick={() => onOpenChange(false)}>
                    {track.artist}
                  </AppLink>
                ) : (
                  track.artist
                )}
              </DrawerDescription>
            </div>
            <div className="flex flex-col gap-1.5">
              <ProgressLine share={progress.share} />
              <div className="flex justify-between text-caption text-secondary tabular">
                <span>{fmtDuration(progress.ms)}</span>
                <span>{fmtDuration(track.durationMs)}</span>
              </div>
            </div>
            <div className="flex items-center justify-center gap-6">
              <IconButton
                icon={ShuffleIcon}
                label="Shuffle"
                size="lg"
                aria-pressed={Boolean(now.data?.shuffle)}
                onClick={() => playback.shuffle(!now.data?.shuffle)}
              />
              <button
                type="button"
                aria-label={playing ? "Pause" : "Play"}
                onClick={() => (playing ? playback.pause() : playback.resume())}
                className="press flex size-16 items-center justify-center rounded-full bg-fill-inverted text-inverted"
              >
                <Icon icon={playing ? PauseIcon : PlayIcon} size="lg" fill />
              </button>
              <IconButton icon={SkipForwardIcon} label="Next" size="lg" fill onClick={() => playback.next()} />
            </div>
          </div>
          <QueueContent open={open} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
