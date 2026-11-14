import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, request } from "../api/client";
import { useDigest, useDigests, useRadar, useStatus, useTimezone } from "../api/queries";
import type { Digest, DigestItem } from "../api/types";
import { assistantProblem } from "../lib/assistant";
import { fmtDate, fmtDay, fmtDayRange, fmtHoursValue, fmtInt, fmtMonthLong, fmtPct } from "../lib/format";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button, buttonClass } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { ArrowLeftIcon, CaretRightIcon, NewspaperIcon } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { Page, PageHeader, Section, useDocumentTitle } from "../ui/Page";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";

type Kind = DigestItem["kind"];

export const recapPeriod = (d: DigestItem) => (d.kind === "monthly" ? fmtMonthLong(d.periodKey) : fmtDayRange(d.from, d.to));
const KIND_LABEL: Record<Kind, string> = { weekly: "Weekly recap", monthly: "Monthly recap" };

const paragraphs = (text: string) => text.split(/\n+/).map((p) => p.trim()).filter(Boolean);

function WriteRecaps({ missing }: { missing: Kind[] }) {
  const queryClient = useQueryClient();
  const status = useStatus();
  const [writing, setWriting] = useState<Kind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (missing.length === 0) return null;
  const llm = status.data?.llm;
  const blocked = !llm ? null : !llm.configured ? "Writing a recap needs a Claude key." : llm.exhausted ? "This month’s Claude spending cap is reached." : null;
  const write = async (kind: Kind) => {
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
  if (blocked)
    return (
      <p className="text-secondary">
        {blocked}{" "}
        <AppLink to="/settings/claude" className="font-medium text-primary underline underline-offset-2">
          Claude settings
        </AppLink>
      </p>
    );
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex flex-col gap-2 md:flex-row">
        {missing.map((kind) => (
          <Button key={kind} disabled={writing !== null} busy={writing === kind} busyLabel="Writing" onClick={() => void write(kind)}>
            {kind === "weekly" ? "Write last week’s recap" : "Write last month’s recap"}
          </Button>
        ))}
      </div>
      {problem && <Notice tone="danger">{problem}</Notice>}
    </div>
  );
}

function Latest({ item }: { item: DigestItem }) {
  const q = useDigest(item.id);
  const lead = q.data ? paragraphs(q.data.text)[0] : null;
  return (
    <AppLink to={`/recaps/${item.id}`} className="group -mx-3 flex flex-col gap-2 rounded-lg px-3 py-3 transition-colors duration-150 hover:bg-fill">
      <span className="text-caption text-secondary">{KIND_LABEL[item.kind]}, the latest</span>
      <span className="font-serif text-figure text-balance text-primary">{recapPeriod(item)}</span>
      {q.isError ? null : lead === null ? (
        <span aria-hidden className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </span>
      ) : (
        <span className="line-clamp-3 text-body text-pretty text-primary">{lead}</span>
      )}
      <span className="text-body-sm font-medium text-primary underline-offset-2 group-hover:underline">Read the recap</span>
    </AppLink>
  );
}

function RecapRow({ item, timezone }: { item: DigestItem; timezone: string }) {
  return (
    <li>
      <AppLink to={`/recaps/${item.id}`} className="-mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-fill">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-primary">{recapPeriod(item)}</span>
          <span className="truncate text-caption text-secondary">
            {KIND_LABEL[item.kind]}, written {fmtDate(item.createdAt, timezone)}
          </span>
        </span>
        <Icon icon={CaretRightIcon} className="text-tertiary" />
      </AppLink>
    </li>
  );
}

export function Recaps() {
  const q = useDigests();
  const timezone = useTimezone();
  const items = q.data?.items ?? [];
  const missing = (["weekly", "monthly"] as Kind[]).filter((k) => !items.some((d) => d.kind === k));
  return (
    <Page width="read">
      <PageHeader title="Recaps" />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div aria-busy className="flex flex-col gap-10">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="flex flex-col gap-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          size="page"
          icon={NewspaperIcon}
          title="No recaps yet"
          description="A weekly recap arrives each week and a monthly one on the 1st. You can write the last one now."
          action={<WriteRecaps missing={missing} />}
        />
      ) : (
        <>
          <Latest item={items[0]!} />
          {items.length > 1 && (
            <Section title="Earlier">
              <ul className="flex flex-col">
                {items.slice(1).map((d) => (
                  <RecapRow key={d.id} item={d} timezone={timezone} />
                ))}
              </ul>
            </Section>
          )}
          <WriteRecaps missing={missing} />
        </>
      )}
    </Page>
  );
}

type Facts = {
  totals?: { hours: number; baselineHours: number; listens: number; baselineListens: number; skipRate: number | null; baselineSkipRate: number | null; uniqueArtists: number };
  topArtists?: { artist: string; hours: number; baselineHours: number }[];
};

function Numbers({ digest }: { digest: Digest }) {
  const facts = digest.facts as Facts;
  const t = facts.totals;
  if (!t) return null;
  const rows: [string, string, string][] = [
    ["Hours", fmtHoursValue(t.hours), fmtHoursValue(t.baselineHours)],
    ["Listens", fmtInt(t.listens), fmtInt(t.baselineListens)],
    ["Skipped", fmtPct(t.skipRate), fmtPct(t.baselineSkipRate)],
    ...(facts.topArtists ?? []).slice(0, 3).map((a): [string, string, string] => [a.artist, `${fmtHoursValue(a.hours)} h`, `${fmtHoursValue(a.baselineHours)} h`]),
  ];
  const usual = digest.kind === "weekly" ? "Usual week" : "Usual month";
  return (
    <Section title="The numbers behind it">
      <table className="-mx-3 w-[calc(100%+24px)] table-fixed border-separate border-spacing-x-3 tabular">
        <caption className="sr-only">Numbers this recap used, against the usual</caption>
        <thead>
          <tr className="text-caption text-secondary">
            <th scope="col" className="pb-2 text-left font-normal">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col" className="w-24 pb-2 text-right font-normal md:w-32">
              {digest.kind === "weekly" ? "This week" : "This month"}
            </th>
            <th scope="col" className="w-24 pb-2 text-right font-normal md:w-32">
              {usual}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, now, before], i) => (
            <tr key={`${label}-${i}`}>
              <th scope="row" className="py-1.5 text-left align-top font-normal break-words text-primary">
                {label}
              </th>
              <td className="py-1.5 text-right align-top text-primary">{now}</td>
              <td className="py-1.5 text-right align-top text-secondary">{before}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

const DAY = 86_400_000;

function Releases({ digest }: { digest: Digest }) {
  const days = Math.min(365, Math.max(1, Math.ceil((Date.now() - Date.parse(`${digest.from}T00:00:00Z`)) / DAY)));
  const radar = useRadar("recent", days);
  const items = (radar.data?.items ?? []).filter((r) => r.releaseDate >= digest.from && r.releaseDate <= digest.to);
  if (items.length === 0) return null;
  return (
    <Section title={digest.kind === "weekly" ? "Released that week" : "Released that month"}>
      <ul className="flex flex-col">
        {items.slice(0, 6).map((r) => (
          <li key={r.id}>
            <a href={r.url} target="_blank" rel="noreferrer" className="-mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-fill">
              <Artwork src={r.imageUrl} name={r.name} box={40} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-primary">{r.name}</span>
                <span className="truncate text-caption text-secondary">
                  {r.artist}, {fmtDay(r.releaseDate)}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Neighbours({ id }: { id: number }) {
  const list = useDigests();
  const items = list.data?.items ?? [];
  const i = items.findIndex((d) => d.id === id);
  if (i < 0) return null;
  const newer = items[i - 1];
  const older = items[i + 1];
  if (!newer && !older) return null;
  return (
    <nav aria-label="Other recaps" className="grid grid-cols-2 gap-4">
      <div>
        {older && (
          <AppLink to={`/recaps/${older.id}`} className="-mx-2 flex flex-col rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-fill">
            <span className="text-caption text-secondary">Older</span>
            <span className="truncate text-primary">{recapPeriod(older)}</span>
          </AppLink>
        )}
      </div>
      <div>
        {newer && (
          <AppLink to={`/recaps/${newer.id}`} className="-mx-2 flex flex-col items-end rounded-md px-2 py-1.5 text-right transition-colors duration-150 hover:bg-fill">
            <span className="text-caption text-secondary">Newer</span>
            <span className="max-w-full truncate text-primary">{recapPeriod(newer)}</span>
          </AppLink>
        )}
      </div>
    </nav>
  );
}

function BackLink() {
  return (
    <AppLink to="/recaps" className={buttonClass({ variant: "ghost", size: "sm", className: "-ml-2.5 self-start" })}>
      <Icon icon={ArrowLeftIcon} />
      Recaps
    </AppLink>
  );
}

export function Recap({ id }: { id: number }) {
  const q = useDigest(id);
  const timezone = useTimezone();
  useDocumentTitle(q.data ? recapPeriod(q.data) : "Recap");
  const notFound = q.error instanceof ApiError && q.error.status === 404;
  return (
    <Page width="read">
      <div className="flex flex-col gap-4">
        <BackLink />
        {q.data ? (
          <header className="flex flex-col">
            <p className="text-caption text-secondary">
              {KIND_LABEL[q.data.kind]}, written {fmtDate(q.data.createdAt, timezone)}
            </p>
            <h1 className="font-serif text-display text-balance text-primary">{recapPeriod(q.data)}</h1>
          </header>
        ) : (
          !q.isError && (
            <div aria-busy className="flex flex-col gap-3">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-11 w-72" />
            </div>
          )
        )}
      </div>
      {notFound ? (
        <EmptyState size="page" icon={NewspaperIcon} title="This recap does not exist" description="It may have been written for another period." />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div aria-busy className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className={i === 4 ? "h-4 w-1/2" : "h-4 w-full"} />
          ))}
        </div>
      ) : (
        <>
          <article className="flex flex-col gap-4">
            <p className="text-heading text-pretty text-primary">{paragraphs(q.data.text)[0]}</p>
            <div className="text-body whitespace-pre-line text-pretty text-primary">{paragraphs(q.data.text).slice(1).join("\n\n")}</div>
          </article>
          <Numbers digest={q.data} />
          <Releases digest={q.data} />
          <Neighbours id={id} />
        </>
      )}
    </Page>
  );
}
