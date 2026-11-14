import { useDeferredValue, useState } from "react";
import { useSearchParams } from "wouter";
import { useSearch, useTopAlbums, useTopArtists } from "../api/queries";
import { fmtHours, fmtInt } from "../lib/format";
import { useDesktop } from "../lib/useMedia";
import { albumPath, artistPath, songPath } from "../ui/AppLink";
import { Shelf, ShelfSkeleton, ShowAll, Tile } from "../ui/Shelf";
import { Page, Section } from "../ui/Page";
import { Row, RowList } from "../ui/rows";
import { Empty, ErrorState, SkeletonRows } from "../ui/states";

function Results({ q }: { q: string }) {
  const search = useSearch(q, 12);
  if (search.isError) return <ErrorState error={search.error} onRetry={() => search.refetch()} />;
  if (!search.data) return <SkeletonRows rows={6} />;
  const { artists, songs, albums } = search.data;
  if (artists.length + songs.length + albums.length === 0)
    return <Empty title={`Nothing matches “${q}”`}>Search looks at artist, song and album names in your listening.</Empty>;
  return (
    <div className={`grid gap-10 lg:grid-cols-2 ${search.isPlaceholderData ? "opacity-60" : ""}`}>
      {songs.length > 0 && (
        <Section title="Songs">
          <RowList>
            {songs.map((s) => (
              <Row
                key={s.songKey}
                to={songPath(s.songKey)}
                art={{ src: s.albumArtUrl }}
                song={{ uri: s.uri, name: s.name }}
                title={s.name}
                subtitle={s.artist}
                value={`${fmtInt(s.listens)} listens`}
              />
            ))}
          </RowList>
        </Section>
      )}
      <div className="flex flex-col gap-10">
        {artists.length > 0 && (
          <Section title="Artists">
            <RowList>
              {artists.map((a) => (
                <Row key={a.artist} to={artistPath(a.artist)} art={{ src: a.imageUrl, round: true }} title={a.artist} value={fmtHours(a.hours)} />
              ))}
            </RowList>
          </Section>
        )}
        {albums.length > 0 && (
          <Section title="Albums">
            <RowList>
              {albums.map((a) => (
                <Row
                  key={`${a.artist}|${a.album}`}
                  to={albumPath(a.artist, a.album)}
                  art={{ src: a.albumArtUrl }}
                  title={a.album}
                  subtitle={a.artist}
                  value={fmtHours(a.hours)}
                />
              ))}
            </RowList>
          </Section>
        )}
      </div>
    </div>
  );
}

function StartingPoints() {
  const artists = useTopArtists({}, 20);
  const albums = useTopAlbums({}, 20);
  const [expanded, setExpanded] = useState<"artists" | "albums" | null>(null);
  const toggle = (shelf: "artists" | "albums") => () => setExpanded((e) => (e === shelf ? null : shelf));
  return (
    <>
      <Section title="Most played artists" aside={<ShowAll expanded={expanded === "artists"} onToggle={toggle("artists")} />}>
        {!artists.data ? (
          <ShelfSkeleton round />
        ) : (
          <Shelf label="Most played artists" expanded={expanded === "artists"}>
            {artists.data.items.map((a) => (
              <Tile key={a.artist} to={artistPath(a.artist)} src={a.imageUrl} round title={a.artist} subtitle={fmtHours(a.hours)} />
            ))}
          </Shelf>
        )}
      </Section>
      <Section title="Most played albums" aside={<ShowAll expanded={expanded === "albums"} onToggle={toggle("albums")} />}>
        {!albums.data ? (
          <ShelfSkeleton />
        ) : (
          <Shelf label="Most played albums" expanded={expanded === "albums"}>
            {albums.data.items.map((a) => (
              <Tile key={`${a.artist}|${a.album}`} to={albumPath(a.artist, a.album)} src={a.albumArtUrl} title={a.album} subtitle={a.artist} />
            ))}
          </Shelf>
        )}
      </Section>
    </>
  );
}

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const desktop = useDesktop();
  const q = params.get("q") ?? "";
  const deferred = useDeferredValue(q.trim());
  return (
    <Page title="Explore">
      <label className="field md:max-w-md">
        <span className="sr-only">Search</span>
        <input
          type="search"
          autoFocus={desktop}
          value={q}
          placeholder="Artist, song or album"
          onChange={(e) =>
            setParams(
              (prev) => {
                const out = new URLSearchParams(prev);
                if (e.target.value) out.set("q", e.target.value);
                else out.delete("q");
                return out;
              },
              { replace: true },
            )
          }
        />
      </label>
      {deferred ? <Results q={deferred} /> : <StartingPoints />}
    </Page>
  );
}
