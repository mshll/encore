import type { ReactNode } from "react";
import { useSessionHabits } from "../../api/queries";
import { InlineColumns } from "../../charts/Inline";
import { fmtDay, fmtHour, fmtOne } from "../../lib/format";
import { fmtMinutes, plural } from "../../lib/insights";
import type { Range } from "../../lib/range";
import { Section, dimWhile } from "../../ui/Page";
import { Skeleton } from "../../ui/Skeleton";
import { ErrorState } from "../../ui/States";

function Fact({ label, figure, detail }: { label: string; figure: ReactNode; detail?: ReactNode }) {
  return (
    <div className="grid min-h-(--row-h-compact) grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-1">
      <dt className="text-secondary">{label}</dt>
      <dd className="flex items-center justify-end gap-2 font-medium text-primary tabular">{figure}</dd>
      {detail && <dd className="col-span-2 truncate text-caption text-secondary">{detail}</dd>}
    </div>
  );
}

export function SessionsSection({ range }: { range: Range }) {
  const q = useSessionHabits(range);
  if (q.data && q.data.count === 0) return null;
  return (
    <Section title="Sessions" description={q.data && `A session ends after ${q.data.gapMinutes} minutes with nothing playing.`} labelledBy="when-sessions">
      {q.isError ? (
        <ErrorState size="inline" error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div aria-busy className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : (
        <dl className={dimWhile(q.isPlaceholderData)}>
          <Fact label="Average length" figure={fmtMinutes(q.data.averageMinutes ?? 0)} detail={plural(q.data.count, "session", "sessions")} />
          <Fact label="A day with music" figure={`${fmtOne(q.data.perDay ?? 0)} sessions`} detail={`Over ${plural(q.data.days, "day", "days")}`} />
          {q.data.usualStart !== null && (
            <Fact
              label="Usually starts"
              figure={
                <>
                  <InlineColumns values={q.data.startHours} mark={q.data.usualStart} bars={24} label={`Sessions started in each hour; the most from ${fmtHour(q.data.usualStart)}`} />
                  {fmtHour(q.data.usualStart)}
                </>
              }
            />
          )}
          {q.data.longest && <Fact label="Longest" figure={fmtMinutes(q.data.longest.minutes)} detail={`${fmtDay(q.data.longest.day)}, ${plural(q.data.longest.plays, "play", "plays")}`} />}
        </dl>
      )}
    </Section>
  );
}
