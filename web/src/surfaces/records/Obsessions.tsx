import { useObsessions } from "../../api/queries";
import { songPath } from "../../app/paths";
import { fmtDayRange, fmtInt } from "../../lib/format";
import type { Range } from "../../lib/range";
import { Section, dimWhile } from "../../ui/Page";
import { Row, RowList, RowSkeleton } from "../../ui/Rows";
import { EmptyState, ErrorState } from "../../ui/States";

export function ObsessionsSection({ range }: { range: Range }) {
  const q = useObsessions(range);
  return (
    <Section title="Obsessions" description={q.data && `Listens in a song's busiest ${q.data.rules.windowDays} days, far above its usual, before it went quiet`} labelledBy="records-obsessions">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={4} />
      ) : q.data.items.length === 0 ? (
        <EmptyState size="inline" title="No obsessions in this range" />
      ) : (
        <RowList label="Obsessions" className={dimWhile(q.isPlaceholderData)}>
          {q.data.items.map((o) => (
            <Row
              key={o.songKey}
              to={songPath(o.songKey)}
              title={o.name}
              subtitle={`${o.artist} · ${fmtDayRange(o.from, o.to)}`}
              art={{ src: o.albumArtUrl, kind: "song" }}
              value={fmtInt(o.listens)}
              song={{ uri: o.uri, name: o.name, songKey: o.songKey, artist: o.artist }}
            />
          ))}
        </RowList>
      )}
    </Section>
  );
}
