import { usePlayerNow } from "../api/queries";
import { Artwork } from "../ui/Artwork";
import { Icon, NextIcon, PauseIcon, PlayIcon, PlayListIcon } from "../ui/Icon";
import { usePlayback } from "./playback";
import { useProgress } from "./progress";

export function MiniPlayer({ onOpen }: { onOpen: (section?: "queue") => void }) {
  const now = usePlayerNow();
  const playback = usePlayback();
  const progress = useProgress(now.data);
  const track = now.data?.track;
  if (!track) return null;
  const playing = now.data!.playing;
  return (
    <>
      <div aria-hidden className="h-[72px] md:hidden" />
      <section
        aria-label="Now playing"
        className="fixed inset-x-2 bottom-[calc(56px+env(safe-area-inset-bottom)+8px)] z-30 overflow-hidden rounded-2xl bg-raised shadow-large md:sticky md:inset-x-auto md:bottom-2 md:mx-auto md:mb-2 md:w-[min(720px,calc(100%-32px))]"
      >
        <div className="flex h-16 items-center gap-1 pr-1.5 pl-2">
          <button
            type="button"
            onClick={() => onOpen()}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1.5 text-left"
            aria-label={`Open now playing: ${track.name} by ${track.artist}`}
          >
            <Artwork src={track.albumArtUrl} name={track.name} className="size-11" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{track.name}</span>
              <span className="truncate text-body-sm text-secondary">
                {track.artist}
                {now.data!.device && <span className="text-tertiary"> · {now.data!.device.name}</span>}
              </span>
            </span>
          </button>
          <button type="button" className="btn btn-icon btn-transparent max-md:hidden" aria-label="Show queue" onClick={() => onOpen("queue")}>
            <Icon icon={PlayListIcon} />
          </button>
          <button
            type="button"
            className="btn btn-icon btn-transparent"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => (playing ? playback.pause() : playback.resume())}
          >
            <Icon icon={playing ? PauseIcon : PlayIcon} />
          </button>
          <button type="button" className="btn btn-icon btn-transparent" aria-label="Next" onClick={() => playback.next()}>
            <Icon icon={NextIcon} />
          </button>
        </div>
        <div
          role="progressbar"
          aria-label="Track progress"
          aria-valuemin={0}
          aria-valuemax={Math.round(track.durationMs / 1000)}
          aria-valuenow={Math.round(progress.ms / 1000)}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-component"
        >
          <div className="h-full origin-left bg-chart-key transition-transform duration-1000 ease-linear" style={{ transform: `scaleX(${progress.share})` }} />
        </div>
      </section>
    </>
  );
}
