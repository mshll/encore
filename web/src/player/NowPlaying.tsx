import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef } from "react";
import { usePlayerNow, usePlayerQueue, useTimezone, useTrackByUri } from "../api/queries";
import type { SkipProfile } from "../api/types";
import { SkipProfileChart } from "../charts/SkipProfileChart";
import { CLASS_LABELS, contextPhrase, fmtAgo, fmtDuration, fmtInt, fmtPct } from "../lib/format";
import { AppLink, artistPath, songPath } from "../ui/AppLink";
import { Artwork, ArtTint } from "../ui/Artwork";
import { Cancel01Icon, Icon, NextIcon, PauseIcon, PlayIcon } from "../ui/Icon";
import { Row, RowList } from "../ui/rows";
import { SkeletonRows } from "../ui/states";
import { openInSpotify, usePlayback } from "./playback";
import { hourBucketNow, useProgress } from "./progress";

function momentNote(profile: SkipProfile, bucket: string): string | null {
  const here = profile.hourBucket.find((v) => v.value === bucket);
  if (!here || here.plays < 5 || here.skipRate === null) return null;
  if (here.skipRate >= 2 / 3) return `You usually skip this ${contextPhrase("hourBucket", bucket)}: ${fmtPct(here.skipRate)} of ${fmtInt(here.plays)} plays.`;
  if (here.skipRate <= 1 / 3) return `This one tends to stick ${contextPhrase("hourBucket", bucket)}: ${fmtPct(here.skipRate)} skipped.`;
  return null;
}

function SongFacts({ uri, onNavigate }: { uri: string; onNavigate: () => void }) {
  const q = useTrackByUri(uri);
  const timezone = useTimezone();
  if (q.isError) return <p className="text-secondary">No plays of this song in encore yet.</p>;
  if (!q.data) return <SkeletonRows rows={3} />;
  const d = q.data;
  const note = d.class === "wrong_moment" ? momentNote(d.skipProfile, hourBucketNow(timezone)) : null;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-lg text-secondary text-pretty">
        <strong className="font-semibold text-primary tabular">{fmtInt(d.totals.listens)}</strong> listens,{" "}
        <strong className="font-semibold text-primary tabular">{fmtPct(d.totals.skipRate)}</strong> skipped
        {d.totals.lastPlayed && <>, last played {fmtAgo(d.totals.lastPlayed)}</>}.{d.class && <> {CLASS_LABELS[d.class]}.</>}
      </p>
      {note && <p className="font-medium text-primary">{note}</p>}
      <SkipProfileChart profile={d.skipProfile} overall={d.totals.skipRate} minPlays={5} />
      <AppLink to={songPath(d.songKey)} onClick={onNavigate} className="btn btn-secondary self-start">
        Open song page
      </AppLink>
    </div>
  );
}

function Queue({ open }: { open: boolean }) {
  const q = usePlayerQueue(open);
  if (q.isError) return <p className="text-secondary">The queue could not be read from Spotify.</p>;
  if (!q.data) return <SkeletonRows rows={5} />;
  if (q.data.queue.length === 0) return <p className="text-secondary">Nothing queued after this song.</p>;
  return (
    <RowList>
      {q.data.queue.slice(0, 20).map((t, i) => (
        <Row key={`${t.uri}-${i}`} art={{ src: t.albumArtUrl }} title={t.name} subtitle={t.artist} song={{ uri: t.uri, name: t.name }} />
      ))}
    </RowList>
  );
}

export function NowPlaying({ open, section, onOpenChange }: { open: boolean; section?: "queue"; onOpenChange: (open: boolean) => void }) {
  const now = usePlayerNow();
  const playback = usePlayback();
  const progress = useProgress(now.data);
  const queueRef = useRef<HTMLElement>(null);
  const track = now.data?.track;
  useEffect(() => {
    if (open && section === "queue") requestAnimationFrame(() => queueRef.current?.scrollIntoView({ block: "start" }));
  }, [open, section]);
  useEffect(() => {
    if (open && !track) onOpenChange(false);
  }, [open, track, onOpenChange]);
  if (!track) return null;
  const playing = now.data!.playing;
  const close = () => onOpenChange(false);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/60" />
        <Dialog.Popup className="fixed inset-0 z-50 isolate overflow-y-auto bg-canvas outline-none transition-[opacity,transform] duration-200 ease-(--ease-out-quint) data-ending-style:translate-y-4 data-ending-style:opacity-0 data-starting-style:translate-y-4 data-starting-style:opacity-0 md:inset-8 md:mx-auto md:max-w-5xl md:rounded-3xl md:shadow-extra-large">
          <ArtTint src={track.albumArtUrl} />
          <div className="flex items-center justify-between safe-x pt-[max(12px,env(safe-area-inset-top))] md:px-8 md:pt-6">
            <Dialog.Title className="text-body-sm font-medium text-secondary">Now playing{now.data!.device && ` on ${now.data!.device.name}`}</Dialog.Title>
            <Dialog.Close className="btn btn-icon btn-transparent" aria-label="Close">
              <Icon icon={Cancel01Icon} />
            </Dialog.Close>
          </div>
          <div className="grid gap-10 safe-x pt-4 pb-[max(32px,env(safe-area-inset-bottom))] md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:gap-14 md:px-8 md:pb-10">
            <div className="flex flex-col gap-5">
              <Artwork src={track.albumArtUrl} name={track.name} size="lg" className="w-full max-w-[420px] self-center rounded-2xl shadow-large" />
              <div className="flex flex-col gap-1">
                <h2 className="text-heading-5 font-semibold text-balance">{track.name}</h2>
                <AppLink to={artistPath(track.artist)} onClick={close} className="text-body-lg text-secondary hover-fine:text-primary">
                  {track.artist}
                </AppLink>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="h-1 overflow-hidden rounded-full bg-component">
                  <div
                    className="h-full origin-left bg-chart-key transition-transform duration-1000 ease-linear"
                    style={{ transform: `scaleX(${progress.share})` }}
                  />
                </div>
                <div className="flex justify-between text-caption-lg text-secondary tabular">
                  <span>{fmtDuration(progress.ms)}</span>
                  <span>{fmtDuration(track.durationMs)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn btn-primary btn-lg" onClick={() => (playing ? playback.pause() : playback.resume())}>
                  <Icon icon={playing ? PauseIcon : PlayIcon} />
                  {playing ? "Pause" : "Play"}
                </button>
                <button type="button" className="btn btn-secondary btn-lg" onClick={() => playback.next()}>
                  <Icon icon={NextIcon} />
                  Next
                </button>
                <a className="btn btn-transparent btn-lg" href={openInSpotify(track.uri)} target="_blank" rel="noreferrer">
                  Open in Spotify
                </a>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-10">
              <section className="flex flex-col gap-4">
                <h3 className="text-heading-6 font-semibold">This song in encore</h3>
                <SongFacts uri={track.uri} onNavigate={close} />
              </section>
              <section ref={queueRef} className="flex scroll-mt-4 flex-col gap-2">
                <h3 className="text-heading-6 font-semibold">Up next</h3>
                <Queue open={open} />
              </section>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
