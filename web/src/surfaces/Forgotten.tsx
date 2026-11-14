import { useState } from "react";
import { useForgotten } from "../api/queries";
import { songPath } from "../app/paths";
import { fmtAgo, fmtInt } from "../lib/format";
import { cx } from "../ui/cx";
import { Row, RowList, RowSkeleton } from "../ui/Rows";
import { Segmented } from "../ui/Segmented";
import { EmptyState, ErrorState } from "../ui/States";

const WINDOWS = [
  { value: "90", label: "3 months" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
  { value: "730", label: "2 years" },
] as const;

const LIMIT = 100;

type Window = (typeof WINDOWS)[number]["value"];

/** Favourites you dropped: songs with enough listens and no play inside the chosen window. */
export function Forgotten() {
  const [days, setDays] = useState<Window>("180");
  const q = useForgotten(Number(days));
  const label = WINDOWS.find((w) => w.value === days)!.label;
  const items = q.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Segmented label="Not played for" value={days} onChange={setDays} options={[...WINDOWS]} className="md:self-start" />
      <p className="min-h-5 text-secondary text-pretty tabular" aria-live="polite">
        {q.data && !q.isError ? `${items.length >= LIMIT ? `Top ${LIMIT}` : fmtInt(items.length)} ${items.length === 1 ? "song" : "songs"} with ${fmtInt(q.data.minListens)} or more listens, none in ${label}` : " "}
      </p>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={10} />
      ) : items.length === 0 ? (
        <EmptyState title={`Nothing forgotten in ${label}`} description="Every song you played often came back more recently. Try a shorter window." />
      ) : (
        <div className={cx("flex flex-col transition-opacity duration-200", q.isPlaceholderData && "opacity-60")}>
          <div aria-hidden className="flex h-9 items-center gap-3 text-caption text-secondary">
            <span className="size-8 shrink-0 phone:size-10" />
            <span className="flex-1">Song</span>
            <span className="w-16 shrink-0 text-right">Listens</span>
            <span className="w-[calc(var(--control-h-sm)*2)] shrink-0 max-md:w-(--control-h-sm)" />
          </div>
          <RowList label={`Songs not played in ${label}`}>
            {items.map((s) => (
              <Row
                key={s.songKey}
                to={songPath(s.songKey)}
                title={s.name}
                subtitle={s.lastPlayed ? `${s.artist} · last played ${fmtAgo(s.lastPlayed)}` : s.artist}
                art={{ src: s.albumArtUrl }}
                value={fmtInt(s.listens)}
                song={{ uri: s.uri, name: s.name, songKey: s.songKey, artist: s.artist }}
              />
            ))}
          </RowList>
        </div>
      )}
    </div>
  );
}
