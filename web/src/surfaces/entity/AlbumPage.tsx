import { useAlbumPage } from "../../api/queries";
import { artistPath } from "../../app/paths";
import { fmtInt } from "../../lib/format";
import { useRange } from "../../lib/range";
import { usePlayback } from "../../player/playback";
import { AppLink } from "../../ui/AppLink";
import { Button } from "../../ui/Button";
import { EntityHeader } from "../../ui/EntityHeader";
import { PlayIcon } from "../../ui/icons";
import { Page, Section, dimWhile, useDocumentTitle } from "../../ui/Page";
import { RangePicker } from "../../ui/RangePicker";
import { EntityLoading, EntityMissing, FirstLast, Listening, SkipContext, SongList, usePeriod } from "./parts";

export function AlbumPage({ artist, album }: { artist: string; album: string }) {
  const { range } = useRange();
  const { period } = usePeriod(range);
  const q = useAlbumPage(artist, album, range, period);
  const playback = usePlayback();
  useDocumentTitle(album);
  if (q.isError)
    return (
      <Page>
        <EntityMissing error={q.error} onRetry={() => q.refetch()} title={album} what="album" />
      </Page>
    );
  if (!q.data)
    return (
      <Page>
        <EntityLoading />
      </Page>
    );
  const d = q.data;
  const songs = d.tracks.length;
  return (
    <Page className={dimWhile(q.isPlaceholderData)}>
      <EntityHeader
        kind="album"
        title={d.album}
        art={d.albumArtUrl}
        credits={
          <>
            <AppLink to={artistPath(d.artist)} className="py-1 text-primary hover:underline">
              {d.artist}
            </AppLink>
            , {fmtInt(songs)} {songs === 1 ? "song" : "songs"} played
          </>
        }
        detail={<FirstLast totals={d.totals} />}
        actions={
          <Button variant="accent" icon={PlayIcon} onClick={() => playback.play(d.tracks.map((t) => t.uri))}>
            Play
          </Button>
        }
        aside={<RangePicker />}
      />
      <Listening totals={d.totals} timeline={d.timeline} />
      <Section title="Songs">
        <SongList songs={d.tracks} label="Songs" initial={20} subtitle={(s) => `${fmtInt(s.listens)} ${s.listens === 1 ? "listen" : "listens"}`} />
      </Section>
      <SkipContext totals={d.totals} profile={d.skipProfile} />
    </Page>
  );
}
