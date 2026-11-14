import { useMutation, useQueryClient } from "@tanstack/react-query";
import { request } from "../api/client";
import { useDj, usePlayerNow, usePlayerQueue, useTrackByUri } from "../api/queries";
import type { TrackRef } from "../api/types";
import { songPath } from "../app/paths";
import { CLASS_LABELS, fmtAgo, fmtInt, fmtPct } from "../lib/format";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { WaveformIcon, XIcon } from "../ui/icons";
import { RowSkeleton } from "../ui/Rows";
import { SongMenu } from "../ui/SongMenu";
import { EmptyState, ErrorState } from "../ui/States";
import { showToast } from "../lib/toast";
import { useTrackLinks } from "./links";

function QueueRow({ track }: { track: TrackRef }) {
  return (
    <li className="group flex min-h-12 items-center gap-3">
      <Artwork src={track.albumArtUrl} kind="song" box={40} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{track.name}</span>
        <span className="truncate text-caption text-secondary">{track.artist}</span>
      </span>
      <SongMenu song={{ uri: track.uri, name: track.name, artist: track.artist }} className="md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[popup-open]:opacity-100" />
    </li>
  );
}

function NowArtist({ uri, artist }: { uri: string; artist: string }) {
  const links = useTrackLinks(uri);
  if (!links) return <span className="truncate text-caption text-secondary">{artist}</span>;
  return (
    <AppLink to={links.artist} className="-my-1 truncate py-1 text-caption text-secondary hover:text-primary hover:underline">
      {artist}
    </AppLink>
  );
}

/** What encore knows about the playing song: listens, skip rate, its class. */
function SongFacts({ uri }: { uri: string }) {
  const q = useTrackByUri(uri);
  if (q.isError) return <p className="text-caption text-secondary">First play of this song in encore.</p>;
  if (!q.data) return <p className="text-caption text-tertiary">Loading listens…</p>;
  const d = q.data;
  return (
    <p className="text-caption text-secondary tabular">
      {fmtInt(d.totals.listens)} listens · {fmtPct(d.totals.skipRate)} skipped
      {d.totals.lastPlayed && <> · last {fmtAgo(d.totals.lastPlayed)}</>}
      {d.class && <> · {CLASS_LABELS[d.class]}</>} ·{" "}
      <AppLink to={songPath(d.songKey)} className="text-primary underline decoration-line-strong underline-offset-2 hover:decoration-current">
        Song page
      </AppLink>
    </p>
  );
}

function Session() {
  const dj = useDj();
  const queryClient = useQueryClient();
  const stop = useMutation({
    mutationFn: () => request("/api/dj/stop", { json: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dj"] }),
    onError: () => showToast("The session could not be stopped. Try again.", "problem"),
  });
  const session = dj.data?.session;
  if (!session || session.status !== "active") return null;
  return (
    <section aria-label="Session" className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className="text-caption text-secondary">Playing from session</span>
        <span className="truncate">{session.set?.title ?? "Your session"}</span>
      </div>
      <Button size="sm" busy={stop.isPending} busyLabel="Stopping" onClick={() => stop.mutate()}>
        Stop
      </Button>
    </section>
  );
}

/** Now playing, the session it plays from, and what comes next. Shared by the desktop panel and the phone sheet. */
export function QueueContent({ open }: { open: boolean }) {
  const now = usePlayerNow();
  const queue = usePlayerQueue(open);
  const track = now.data?.track;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="np-title" className="flex flex-col gap-3">
        <h3 id="np-title" className="text-caption font-medium text-secondary">
          Now playing
        </h3>
        {track ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Artwork src={track.albumArtUrl} kind="song" box={56} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-1.5">
                  {now.data?.playing && <Icon icon={WaveformIcon} fill className="text-accent-text" />}
                  <span className="truncate font-medium">{track.name}</span>
                </span>
                <NowArtist uri={track.uri} artist={track.artist} />
              </div>
            </div>
            <SongFacts uri={track.uri} />
          </div>
        ) : (
          <EmptyState size="inline" title="Nothing playing" description="Start something in Spotify and it shows here." />
        )}
      </section>
      <Session />
      <section aria-labelledby="next-title" className="flex flex-col gap-2">
        <h3 id="next-title" className="text-caption font-medium text-secondary">
          Next up
        </h3>
        {queue.isError ? (
          <ErrorState size="inline" title="Could not read the queue" error={queue.error} onRetry={() => queue.refetch()} />
        ) : !queue.data ? (
          <RowSkeleton rows={4} />
        ) : queue.data.queue.length === 0 ? (
          <p className="text-secondary">Nothing queued after this song.</p>
        ) : (
          <ol className="flex flex-col">
            {queue.data.queue.slice(0, 30).map((t, i) => (
              <QueueRow key={`${t.uri}-${i}`} track={t} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** Desktop: opens on the right, beside the page, without dimming it (TIDAL, Suno). */
export function QueuePanel({ onClose }: { onClose: () => void }) {
  return (
    <aside aria-label="Queue" className="flex h-full w-(--panel-w) flex-col overflow-hidden rounded-xl bg-container shadow-panel">
      <div className="flex h-14 shrink-0 items-center justify-between pr-2 pl-4">
        <h2 className="text-heading font-medium">Queue</h2>
        <IconButton icon={XIcon} label="Close queue" onClick={onClose} />
      </div>
      <div data-crop className="flex-1 overflow-y-auto px-4 pb-4">
        <QueueContent open />
      </div>
    </aside>
  );
}
