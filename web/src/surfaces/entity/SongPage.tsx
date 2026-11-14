import { useTrackPage } from "../../api/queries";
import type { MomentClass, TrackPage } from "../../api/types";
import { albumPath, artistPath } from "../../app/paths";
import { fmtInt } from "../../lib/format";
import { useRange } from "../../lib/range";
import { usePlayback } from "../../player/playback";
import { AppLink } from "../../ui/AppLink";
import { Button, buttonClass } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { EntityHeader } from "../../ui/EntityHeader";
import { PlayIcon } from "../../ui/icons";
import { Page, Section, dimWhile, useDocumentTitle } from "../../ui/Page";
import { RangePicker } from "../../ui/RangePicker";
import { SongMenu } from "../../ui/SongMenu";
import { LinerNotes } from "./LinerNotes";
import { EntityLoading, EntityMissing, FirstLast, Listening, SkipContext, usePeriod } from "./parts";

/** How the song's skips read across contexts. Worded as context, never as a judgement of the song. */
const MOMENT: Record<MomentClass, string> = {
  keeper: "You play this one through.",
  wrong_moment: "It depends on the moment: it plays through in some contexts and gets skipped in others.",
  skipped_everywhere: "Skipped in every context with enough plays to tell.",
  mixed: "Skipped now and then, with no clear pattern by context.",
};

function Versions({ uris }: { uris: TrackPage["uris"] }) {
  if (uris.length < 2) return null;
  return (
    <Section title="Versions">
      <ul className="flex flex-col">
        {uris.map((u) => (
          <li key={u.uri} className="flex min-h-(--row-h) flex-col justify-center">
            <span className="truncate">{u.name}</span>
            <span className="truncate text-caption text-secondary">
              {[u.album, `${fmtInt(u.plays)} ${u.plays === 1 ? "play" : "plays"}`].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function SongPage({ songKey }: { songKey: string }) {
  const { range } = useRange();
  const { period } = usePeriod(range);
  const q = useTrackPage(songKey, range, period);
  const playback = usePlayback();
  useDocumentTitle(q.data?.name ?? "Song");
  if (q.isError)
    return (
      <Page crumb={null}>
        <EntityMissing error={q.error} onRetry={() => q.refetch()} title="Song" what="song" />
      </Page>
    );
  if (!q.data)
    return (
      <Page>
        <EntityLoading />
      </Page>
    );
  const d = q.data;
  return (
    <Page crumb={d.name} className={dimWhile(q.isPlaceholderData)}>
      <EntityHeader
        kind="song"
        title={d.name}
        art={d.albumArtUrl}
        credits={
          <>
            <AppLink to={artistPath(d.artist)} className="py-1 text-primary hover:underline">
              {d.artist}
            </AppLink>
            {d.album && (
              <>
                {" · "}
                <AppLink to={albumPath(d.artist, d.album)} className="py-1 hover:text-primary hover:underline">
                  {d.album}
                </AppLink>
              </>
            )}
          </>
        }
        detail={<FirstLast totals={d.totals} />}
        actions={
          <>
            <Button variant="accent" icon={PlayIcon} onClick={() => playback.play([d.uri])}>
              Play
            </Button>
            <AppLink to={`/plays?songKey=${encodeURIComponent(d.songKey)}`} className={buttonClass()}>
              Every play
            </AppLink>
            <SongMenu song={{ uri: d.uri, name: d.name, artist: d.artist }} className="size-(--control-h)" />
          </>
        }
        aside={<RangePicker />}
      />
      <Listening totals={d.totals} timeline={d.timeline} />
      <div className={cx("grid gap-10 lg:gap-12", d.uris.length > 1 && "lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]")}>
        <LinerNotes songKey={d.songKey} />
        <Versions uris={d.uris} />
      </div>
      <SkipContext totals={d.totals} profile={d.skipProfile} minPlays={3} lead={d.class && <p className="text-body font-medium text-pretty">{MOMENT[d.class]}</p>} />
    </Page>
  );
}
