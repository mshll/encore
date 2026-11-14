import type { ContextDimension, SkipProfile } from "../api/types";
import { contextLabel, DIMENSION_LABELS, fmtInt, fmtPct } from "../lib/format";

const ORDER: ContextDimension[] = ["hourBucket", "dayType", "startMode", "shuffle", "device"];
const WORKS = 1 / 3;
const FAILS = 2 / 3;

export function SkipProfileChart({ profile, overall, minPlays = 3 }: { profile: SkipProfile; overall: number | null; minPlays?: number }) {
  const groups = ORDER.map((d) => ({ d, values: profile[d].filter((v) => v.plays >= minPlays && v.skipRate !== null) })).filter((g) => g.values.length > 0);
  if (groups.length === 0) return <p className="text-secondary">Not enough plays with skip data to compare contexts.</p>;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-body-sm text-secondary">
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-4 rounded-sm bg-chart-key" />
          Plays through, {fmtPct(WORKS)} or less skipped
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-4 rounded-sm bg-(--gray-12)" />
          Skipped, {fmtPct(FAILS)} or more
        </span>
        {overall !== null && (
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-3 w-px bg-(--fg-primary)" />
            Overall {fmtPct(overall)}
          </span>
        )}
      </div>
      <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">
        {groups.map(({ d, values }) => (
          <div key={d} className="flex flex-col gap-2">
            <h3 className="text-body-sm font-medium text-secondary">{DIMENSION_LABELS[d]}</h3>
            <ul className="flex flex-col gap-2.5">
              {values.map((v) => {
                const rate = v.skipRate!;
                const fill = rate <= WORKS ? "var(--chart-key)" : rate >= FAILS ? "var(--gray-12)" : "var(--chart-muted)";
                return (
                  <li key={v.value} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                    <span className="truncate text-body-sm">{contextLabel(d, v.value)}</span>
                    <span className="text-body-sm tabular">
                      <span className="font-semibold">{fmtPct(rate)}</span> <span className="text-secondary">of {fmtInt(v.plays)} plays</span>
                    </span>
                    <span className="relative col-span-2 h-2 rounded-full bg-component">
                      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(rate * 100, 1)}%`, background: fill }} />
                      {overall !== null && (
                        <span aria-hidden className="absolute -top-1 -bottom-1 w-px bg-(--fg-primary)" style={{ left: `${overall * 100}%` }} />
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
