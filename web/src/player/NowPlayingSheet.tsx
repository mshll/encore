import { Dialog } from "@base-ui/react/dialog";
import { useEffect } from "react";
import { usePlayerNow } from "../api/queries";
import { fmtDuration } from "../lib/format";
import { Artwork } from "../ui/Artwork";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { PauseIcon, PlayIcon, ShuffleIcon, SkipForwardIcon } from "../ui/icons";
import { BACKDROP } from "../ui/surfaces";
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={BACKDROP} />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-env(safe-area-inset-top)-24px)] flex-col rounded-t-[14px] bg-overlay shadow-modal outline-none transition-transform duration-300 ease-(--ease-drawer) data-[ending-style]:translate-y-full data-[ending-style]:duration-200 data-[starting-style]:translate-y-full motion-reduce:transition-opacity motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-y-0 motion-reduce:data-[starting-style]:opacity-0">
          <Dialog.Close aria-label="Close" className="mx-auto flex h-11 w-[88px] shrink-0 items-center justify-center">
            <span className="h-[5px] w-9 rounded-full bg-fill-active" />
          </Dialog.Close>
          <div data-crop className="flex flex-col gap-6 overflow-y-auto px-5 pb-[max(24px,env(safe-area-inset-bottom))]">
            <div className="flex flex-col gap-5">
              <Artwork src={track.albumArtUrl} name={track.name} box="fill" className="mx-auto max-w-[320px] rounded-lg" />
              <div className="flex flex-col">
                <Dialog.Title className="text-heading font-medium text-balance">
                  {links ? (
                    <AppLink to={links.song} onClick={() => onOpenChange(false)}>
                      {track.name}
                    </AppLink>
                  ) : (
                    track.name
                  )}
                </Dialog.Title>
                <Dialog.Description className="text-secondary">
                  {links ? (
                    <AppLink to={links.artist} onClick={() => onOpenChange(false)}>
                      {track.artist}
                    </AppLink>
                  ) : (
                    track.artist
                  )}
                </Dialog.Description>
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
                  className={now.data?.shuffle ? "text-accent-text" : ""}
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
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
