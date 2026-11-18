import { usePodcasts, useTimezone } from "../api/queries";
import { fmtAgo, fmtDate, fmtHours } from "../lib/format";
import { plural } from "../lib/insights";
import { useRange } from "../lib/range";
import { cx } from "../ui/cx";
import { MicrophoneIcon } from "../ui/icons";
import { SECTIONS, SIDE_COLUMNS, Section, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { Row, RowList, RowSkeleton } from "../ui/Rows";
import { EmptyState, ErrorState } from "../ui/States";

const UNNAMED = "Unnamed show";

/** Podcast listening: shows by hours, then the latest episodes. */
export function Podcasts() {
  const { range } = useRange();
  const timezone = useTimezone();
  const q = usePodcasts(range);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <RowSkeleton rows={8} />;
  const { shows, recent } = q.data;
  if (q.data.plays === 0)
    return <EmptyState size="section" icon={MicrophoneIcon} title="No podcasts in this range" description="Podcast episodes you play in Spotify show up here." action={<RangePicker />} />;
  const top = shows[0]?.hours || 1;
  return (
    <div className={cx(SECTIONS, dimWhile(q.isPlaceholderData))}>
      <p className="text-secondary tabular">
        {fmtHours(q.data.hours)} over {plural(q.data.plays, "episode play", "episode plays")}
      </p>
      <div className={SIDE_COLUMNS}>
        <Section title="Shows" description="By hours listened" labelledBy="podcast-shows">
          <RowList label="Shows by hours">
            {shows.map((s, i) => (
              <Row
                key={s.show ?? UNNAMED}
                rank={i + 1}
                title={s.show ?? UNNAMED}
                subtitle={`${plural(s.episodes, "episode", "episodes")}${s.lastPlayed ? ` · last played ${fmtAgo(s.lastPlayed)}` : ""}`}
                art={{ src: null, kind: "podcast" }}
                value={fmtHours(s.hours)}
                share={s.hours / top}
              />
            ))}
          </RowList>
        </Section>
        <Section title="Latest episodes" labelledBy="podcast-recent">
          <RowList label="Latest episodes">
            {recent.map((e) => (
              <Row
                key={`${e.ts}|${e.uri ?? e.episode}`}
                title={e.episode ?? UNNAMED}
                subtitle={`${e.show ?? UNNAMED} · ${fmtDate(e.ts, timezone)}`}
                art={{ src: null, kind: "podcast" }}
                value={fmtHours(e.minutes / 60)}
              />
            ))}
          </RowList>
        </Section>
      </div>
    </div>
  );
}
