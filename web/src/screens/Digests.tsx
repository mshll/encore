import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../api/client";
import { useDigest, useDigests, useRadar } from "../api/queries";
import type { Digest, DigestItem } from "../api/types";
import { assistantProblem } from "../lib/assistant";
import { fmtDay, fmtDayRange, fmtHoursValue, fmtInt, fmtMonthLong, fmtPct } from "../lib/format";
import { Artwork } from "../ui/Artwork";
import { Empty, ErrorState, Skeleton } from "../ui/states";

type Facts = {
  totals?: {
    hours: number;
    baselineHours: number;
    listens: number;
    baselineListens: number;
    skipRate: number | null;
    baselineSkipRate: number | null;
    uniqueArtists: number;
  };
  topArtists?: { artist: string; hours: number; baselineHours: number }[];
  newArtists?: { count: number };
};

const DAY = 86_400_000;

function NumbersUsed({ facts }: { facts: Facts }) {
  const t = facts.totals;
  if (!t) return null;
  const rows: [string, string, string][] = [
    ["Hours", fmtHoursValue(t.hours), fmtHoursValue(t.baselineHours)],
    ["Listens", fmtInt(t.listens), fmtInt(t.baselineListens)],
    ["Skip rate", fmtPct(t.skipRate), fmtPct(t.baselineSkipRate)],
    ...(facts.topArtists ?? [])
      .slice(0, 3)
      .map((a): [string, string, string] => [a.artist, `${fmtHoursValue(a.hours)} h`, `${fmtHoursValue(a.baselineHours)} h`]),
  ];
  return (
    <table className="w-full max-w-md text-body-sm tabular">
      <caption className="sr-only">Numbers this digest used</caption>
      <thead>
        <tr className="text-secondary">
          <th scope="col" className="py-1 text-left font-medium">
            Numbers used
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            This period
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            Usual
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, now, usual]) => (
          <tr key={label} className="border-t-[0.5px] border-border-default">
            <th scope="row" className="truncate py-1 text-left font-normal">
              {label}
            </th>
            <td className="py-1 text-right">{now}</td>
            <td className="py-1 text-right text-secondary">{usual}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PeriodReleases({ digest }: { digest: Digest }) {
  const days = Math.min(365, Math.max(1, Math.ceil((Date.now() - Date.parse(`${digest.from}T00:00:00Z`)) / DAY)));
  const radar = useRadar("recent", days);
  const items = (radar.data?.items ?? []).filter((r) => r.releaseDate >= digest.from && r.releaseDate <= digest.to);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body-sm font-medium text-secondary">Released that {digest.kind === "weekly" ? "week" : "month"}</p>
      <ul className="flex flex-col gap-2">
        {items.slice(0, 6).map((r) => (
          <li key={r.id}>
            <a href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 hover-fine:text-primary">
              <Artwork src={r.imageUrl} name={r.name} className="size-10" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{r.name}</span>
                <span className="truncate text-body-sm text-secondary">
                  {r.artist} · {fmtDay(r.releaseDate)}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DigestEntry({ item }: { item: DigestItem }) {
  const q = useDigest(item.id);
  const heading = item.kind === "monthly" ? fmtMonthLong(item.periodKey) : fmtDayRange(item.from, item.to);
  return (
    <article className="grid gap-x-10 gap-y-4 border-t-[0.5px] border-border-strong pt-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-body-lg font-semibold">{heading}</h2>
        <p className="text-body-sm text-secondary">{item.kind === "monthly" ? "Monthly recap" : "Weekly digest"}</p>
      </div>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <Skeleton className="h-32 w-full max-w-2xl" />
      ) : (
        <div className="flex max-w-2xl min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-3">
            {q.data.text
              .split(/\n+/)
              .filter(Boolean)
              .map((p, i) => (
                <p key={i} className={i === 0 ? "text-body-lg font-medium text-pretty" : "text-pretty"}>
                  {p}
                </p>
              ))}
          </div>
          <NumbersUsed facts={q.data.facts as Facts} />
          <PeriodReleases digest={q.data} />
        </div>
      )}
    </article>
  );
}

export function Digests() {
  const q = useDigests();
  const queryClient = useQueryClient();
  const [writing, setWriting] = useState<"weekly" | "monthly" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const write = async (kind: "weekly" | "monthly") => {
    setWriting(kind);
    setProblem(null);
    try {
      await request("/api/digests/generate", { json: { kind } });
      await queryClient.invalidateQueries({ queryKey: ["digests"] });
    } catch (error) {
      setProblem(assistantProblem(error));
    } finally {
      setWriting(null);
    }
  };
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-48 w-full" />;
  const hasWeekly = q.data.items.some((d) => d.kind === "weekly");
  const hasMonthly = q.data.items.some((d) => d.kind === "monthly");
  return (
    <div className="flex flex-col gap-10">
      {q.data.items.length === 0 && <Empty title="No digests yet">A weekly digest of your listening and a monthly recap land here.</Empty>}
      {(!hasWeekly || !hasMonthly) && (
        <div className="flex flex-wrap gap-2">
          {!hasWeekly && (
            <button type="button" className="btn btn-secondary" disabled={writing !== null} onClick={() => write("weekly")}>
              {writing === "weekly" ? "Writing" : "Write last week’s digest"}
            </button>
          )}
          {!hasMonthly && (
            <button type="button" className="btn btn-secondary" disabled={writing !== null} onClick={() => write("monthly")}>
              {writing === "monthly" ? "Writing" : "Write last month’s recap"}
            </button>
          )}
        </div>
      )}
      {problem && (
        <p role="alert" className="text-danger">
          {problem}
        </p>
      )}
      {q.data.items.map((d) => (
        <DigestEntry key={d.id} item={d} />
      ))}
    </div>
  );
}
