import { useEncoreFinds, useRotation } from "../../api/queries";
import type { EncoreFinds, FindSource, Rotation } from "../../api/types";
import { songPath } from "../../app/paths";
import { DitherBars } from "../../charts/Dither";
import { InlineFact } from "../../charts/Inline";
import { fmtCompact, fmtDayRange, fmtDayShort, fmtInt } from "../../lib/format";
import { plural } from "../../lib/insights";
import type { Range } from "../../lib/range";
import { useDesktop } from "../../lib/useMedia";
import { Section, dimWhile } from "../../ui/Page";
import { Row, RowList, RowSkeleton } from "../../ui/Rows";
import { ChartSkeleton } from "../../ui/Skeleton";
import { EmptyState, ErrorState } from "../../ui/States";

const SOURCE_LABEL: Record<FindSource, string> = { picks: "Weekly picks", sets: "A set", releases: "New from your artists" };

const bucketLabel = (b: Rotation["buckets"][number]) => (b.to === null ? `Over ${fmtInt(b.from - 1)} days` : b.from === b.to ? plural(b.from, "day", "days") : `${fmtInt(b.from)}–${fmtInt(b.to)} days`);

function RotationBody({ data }: { data: Rotation }) {
  const desktop = useDesktop();
  return (
    <div className="flex flex-col gap-5">
      {data.medianDays !== null && (
        <InlineFact label="Median run" figure={plural(Math.round(data.medianDays), "day", "days")}>
          <span className="text-secondary">for the {plural(data.inRotation, "song", "songs")} played on two days or more, of {fmtInt(data.songs)} new</span>
        </InlineFact>
      )}
      <DitherBars
        label="New songs by how long they stayed"
        rows={data.buckets.map((b) => ({ bucket: bucketLabel(b), songs: b.songs }))}
        xKey="bucket"
        tipLabel="bucket"
        valueKey="songs"
        valueLabel="Songs"
        xFormat={(v) => v}
        format={(v) => fmtCompact(v)}
        table={{ format: (v) => String(v) }}
        height={desktop ? 160 : 140}
      />
      {data.longest.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium text-secondary">Longest runs</h3>
          <RowList label="Longest runs">
            {data.longest.map((s) => (
              <Row
                key={s.songKey}
                to={songPath(s.songKey)}
                title={s.name}
                subtitle={`${s.artist} · ${s.ongoing ? `since ${fmtDayShort(s.from)}, still going` : fmtDayRange(s.from, s.to)}`}
                art={{ src: s.albumArtUrl, kind: "song" }}
                value={plural(s.days, "day", "days")}
                song={{ uri: s.uri, name: s.name, songKey: s.songKey, artist: s.artist }}
              />
            ))}
          </RowList>
        </div>
      )}
    </div>
  );
}

export function RotationSection({ range }: { range: Range }) {
  const q = useRotation(range);
  return (
    <Section title="Staying power" description={q.data && `How long new songs stayed: a run ends after ${q.data.rules.gapDays} days without a listen`} labelledBy="discovery-rotation">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <ChartSkeleton className="h-[160px]" />
      ) : q.data.songs === 0 ? (
        <EmptyState size="inline" title="No song was first heard in this range" />
      ) : (
        <div className={dimWhile(q.isPlaceholderData)}>
          <RotationBody data={q.data} />
        </div>
      )}
    </Section>
  );
}

function FindsBody({ data }: { data: EncoreFinds }) {
  if (data.listened === 0) return <EmptyState size="inline" title={`None of the ${plural(data.suggested, "song", "songs")} encore suggested has been played since`} />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-secondary text-pretty">
        <span className="font-medium text-primary tabular">{plural(data.listened, "song", "songs")}</span> of {fmtInt(data.suggested)} suggested, {plural(data.listens, "listen", "listens")} since
      </p>
      <RowList label="What encore found">
        {data.items.map((s) => (
          <Row
            key={s.songKey}
            to={songPath(s.songKey)}
            title={s.name}
            subtitle={`${s.sources.map((x) => SOURCE_LABEL[x]).join(", ")} · ${fmtDayShort(s.suggested)}`}
            art={{ src: s.albumArtUrl, kind: "song" }}
            value={fmtInt(s.listens)}
            song={{ uri: s.uri, name: s.name, songKey: s.songKey, artist: s.artist }}
          />
        ))}
      </RowList>
    </div>
  );
}

export function FindsSection({ range }: { range: Range }) {
  const q = useEncoreFinds(range);
  return (
    <Section title="What encore found" description="Songs new to you when encore suggested them, by listens since" labelledBy="discovery-finds">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={4} />
      ) : q.data.suggested === 0 ? (
        <EmptyState size="inline" title="encore suggested no new songs in this range" />
      ) : (
        <div className={dimWhile(q.isPlaceholderData)}>
          <FindsBody data={q.data} />
        </div>
      )}
    </Section>
  );
}
