import { useState } from "react";
import { useArtistPage, useRadar } from "../../api/queries";
import type { ArtistPage as ArtistData } from "../../api/types";
import { albumPath } from "../../app/paths";
import { fmtDay, fmtHours, fmtInt, fmtMonth } from "../../lib/format";
import { useRange } from "../../lib/range";
import { usePlayback } from "../../player/playback";
import { AppLink } from "../../ui/AppLink";
import { Artwork } from "../../ui/Artwork";
import { Button, buttonClass } from "../../ui/Button";
import { cx } from "../../ui/cx";
import { EntityHeader } from "../../ui/EntityHeader";
import { Icon } from "../../ui/Icon";
import { ArrowUpRightIcon, PlayIcon } from "../../ui/icons";
import { Page, Section, useDocumentTitle } from "../../ui/Page";
import { RangePicker } from "../../ui/RangePicker";
import { Row, RowList } from "../../ui/Rows";
import { EntityLoading, EntityMissing, FirstLast, Listening, SkipContext, SongList, usePeriod } from "./parts";

const releaseDay = (date: string) => (date.length === 10 ? fmtDay(date) : date.length === 7 ? fmtMonth(date) : date);

const RELEASE_KIND = { album: "Album", single: "Single", compilation: "Compilation" } as const;

/** Releases the radar found for this artist in the last year. Hidden when there are none. */
function Releases({ artist }: { artist: string }) {
  const q = useRadar("recent", 365);
  const items = (q.data?.items ?? []).filter((r) => r.artist === artist).slice(0, 6);
  if (items.length === 0) return null;
  return (
    <Section title="Releases this year">
      <ul className="flex flex-col">
        {items.map((r) => (
          <li key={r.id}>
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="group -mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 transition-colors duration-150 hover:bg-fill"
            >
              <Artwork src={r.imageUrl} name={r.name} box={32} className="phone:size-10" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{r.name}</span>
                <span className="truncate text-caption text-secondary">
                  {RELEASE_KIND[r.albumType]}, {releaseDay(r.releaseDate)}
                </span>
              </span>
              <Icon icon={ArrowUpRightIcon} className="text-tertiary" />
              <span className="sr-only">Open in Spotify</span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Albums({ artist, albums }: { artist: string; albums: ArtistData["albums"] }) {
  const [all, setAll] = useState(false);
  if (albums.length === 0) return null;
  const shown = all ? albums : albums.slice(0, 6);
  return (
    <Section title="Albums">
      <div className="flex flex-col gap-2">
        <RowList label="Albums">
          {shown.map((a) => (
            <Row
              key={a.album}
              to={albumPath(artist, a.album)}
              title={a.album}
              subtitle={`${fmtInt(a.plays)} ${a.plays === 1 ? "play" : "plays"}`}
              art={{ src: a.albumArtUrl }}
              value={fmtHours(a.hours)}
            />
          ))}
        </RowList>
        {albums.length > 6 && (
          <Button variant="ghost" size="sm" className="-ml-2.5 self-start" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${fmtInt(albums.length)}`}
          </Button>
        )}
      </div>
    </Section>
  );
}

export function ArtistPage({ name }: { name: string }) {
  const { range } = useRange();
  const { period } = usePeriod(range);
  const q = useArtistPage(name, range, period);
  const playback = usePlayback();
  useDocumentTitle(name);
  if (q.isError)
    return (
      <Page>
        <EntityMissing error={q.error} onRetry={() => q.refetch()} title={name} what="artist" />
      </Page>
    );
  if (!q.data)
    return (
      <Page>
        <EntityLoading round />
      </Page>
    );
  const d = q.data;
  return (
    <Page className={cx("transition-opacity duration-200", q.isPlaceholderData && "opacity-60")}>
      <EntityHeader
        title={d.artist}
        art={d.imageUrl}
        round
        detail={<FirstLast totals={d.totals} />}
        actions={
          <>
            <Button variant="accent" icon={PlayIcon} onClick={() => playback.play(d.tracks.map((t) => t.uri))}>
              Play
            </Button>
            <AppLink to={`/plays?artist=${encodeURIComponent(d.artist)}`} className={buttonClass()}>
              Every play
            </AppLink>
          </>
        }
        aside={<RangePicker />}
      />
      <Listening totals={d.totals} timeline={d.timeline} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:gap-12">
        <Section title="Top songs">
          <SongList songs={d.tracks} label="Top songs" subtitle={(s) => s.album ?? undefined} />
        </Section>
        <div className="flex min-w-0 flex-col gap-10">
          <Albums artist={d.artist} albums={d.albums} />
          <Releases artist={d.artist} />
        </div>
      </div>
      <SkipContext totals={d.totals} profile={d.skipProfile} />
    </Page>
  );
}
