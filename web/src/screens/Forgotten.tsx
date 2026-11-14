import { useState } from "react";
import { useForgotten } from "../api/queries";
import { fmtAgo, fmtInt } from "../lib/format";
import { songPath } from "../ui/AppLink";
import { Page, Section } from "../ui/Page";
import { Row, RowList } from "../ui/rows";
import { Segmented } from "../ui/Segmented";
import { StartSessionButton } from "../ui/SongMenu";
import { Empty, ErrorState, SkeletonRows } from "../ui/states";

const WINDOWS = [
  { value: "90", label: "90 days" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
  { value: "730", label: "2 years" },
];

export default function Forgotten() {
  const [days, setDays] = useState("180");
  const q = useForgotten(Number(days));
  const label = WINDOWS.find((w) => w.value === days)!.label;
  return (
    <Page title="Forgotten" actions={q.data && !q.isPlaceholderData && <StartSessionButton uris={q.data.items.map((s) => s.uri)} />}>
      <Section>
        <p className="max-w-2xl text-body-lg text-secondary text-pretty">Songs you listened to at least 10 times and have not played since.</p>
        <Segmented label="Not played for" value={days} onChange={setDays} options={WINDOWS} className="md:self-start" />
      </Section>
      <Section>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <SkeletonRows rows={10} />
        ) : q.data.items.length === 0 ? (
          <Empty title={`Nothing forgotten in ${label}`}>Every song with 10 or more listens was played more recently. Try a shorter window.</Empty>
        ) : (
          <RowList className={q.isPlaceholderData ? "opacity-60" : ""}>
            {q.data.items.map((s) => (
              <Row
                key={s.songKey}
                to={songPath(s.songKey)}
                art={{ src: s.albumArtUrl }}
                song={{ uri: s.uri, name: s.name }}
                title={s.name}
                subtitle={s.artist}
                value={`${fmtInt(s.listens)} listens`}
                detail={s.lastPlayed ? `played ${fmtAgo(s.lastPlayed)}` : undefined}
              />
            ))}
          </RowList>
        )}
      </Section>
    </Page>
  );
}
