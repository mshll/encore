import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Redirect, useLocation } from "wouter";
import { ApiError, request } from "../api/client";
import { useDigest, useDigests, useLatestRecapKey, useLifetime, useRecapPeriod, useTimezone } from "../api/queries";
import type { Digest, RecapKind, RecapPeriod } from "../api/types";
import { assistantProblem } from "../lib/assistant";
import { fmtDate, fmtDay, fmtDayShort } from "../lib/format";
import { useRun } from "../lib/useRun";
import { AppLink } from "../ui/AppLink";
import { Button, IconButton } from "../ui/Button";
import { useClaudeGate } from "../ui/ClaudeNotice";
import { CaretLeftIcon, CaretRightIcon, NewspaperIcon } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { dimWhile, Page, Section, SECTIONS, useDocumentTitle } from "../ui/Page";
import { Segmented } from "../ui/Segmented";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { RecapPlaylistActions } from "./recaps/Playlist";
import { RecapSections } from "./recaps/Sections";

const SLUGS = { weekly: "week", monthly: "month", yearly: "year" } as const satisfies Record<RecapKind, string>;
type Slug = (typeof SLUGS)[RecapKind];
const KIND_OF: Record<Slug, RecapKind> = { week: "weekly", month: "monthly", year: "yearly" };
const KIND_OPTIONS = (Object.entries(SLUGS) as [RecapKind, Slug][]).map(([, slug]) => ({ value: slug, label: slug === "week" ? "Week" : slug === "month" ? "Month" : "Year" }));
const NOUN: Record<RecapKind, string> = { weekly: "week", monthly: "month", yearly: "year" };

export const recapPath = (kind: RecapKind, key: string) => `/recaps/${SLUGS[kind]}/${key}`;
export const isRecapSlug = (slug: string): slug is Slug => slug in KIND_OF;

function Frame({ kind, period, children }: { kind: RecapKind; period?: RecapPeriod; children: ReactNode }) {
  const [, navigate] = useLocation();
  return (
    <Page width="read">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Segmented label="Recap length" value={SLUGS[kind]} onChange={(slug) => navigate(`/recaps/${slug}`)} options={KIND_OPTIONS} className="md:w-60" />
        <nav aria-label={`Other ${NOUN[kind]}s`} className="flex items-center gap-1">
          <IconButton
            icon={CaretLeftIcon}
            label={period?.previous ? `Previous ${NOUN[kind]}` : `No earlier ${NOUN[kind]}`}
            variant="ghost"
            disabled={!period?.previous}
            onClick={() => period?.previous && navigate(recapPath(kind, period.previous))}
          />
          <span className="min-w-0 flex-1 truncate text-center font-medium text-primary md:min-w-44 md:flex-none">{period ? period.label : <Skeleton className="mx-auto h-4 w-28" />}</span>
          <IconButton
            icon={CaretRightIcon}
            label={period?.next ? `Next ${NOUN[kind]}` : `No later ${NOUN[kind]}`}
            variant="ghost"
            disabled={!period?.next}
            onClick={() => period?.next && navigate(recapPath(kind, period.next))}
          />
        </nav>
      </div>
      {children}
    </Page>
  );
}

/** `/recaps`: the newest recap written, or the month that just ended. */
export function Recaps() {
  const list = useDigests();
  const lifetime = useLifetime();
  const latest = list.data?.items[0];
  if (lifetime.data && !lifetime.data.firstPlayed)
    return (
      <Frame kind="monthly">
        <FirstUseState icon={NewspaperIcon} description="Recaps of each week, month and year appear here once your listening is imported." />
      </Frame>
    );
  if (list.isError)
    return (
      <Frame kind="monthly">
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      </Frame>
    );
  if (!list.data) return <Frame kind="monthly">{<BodySkeleton />}</Frame>;
  return latest ? <Redirect to={recapPath(latest.kind, latest.periodKey)} replace /> : <Redirect to="/recaps/month" replace />;
}

/** `/recaps/week` and friends: the newest period of that length. */
export function RecapKindLatest({ slug }: { slug: string }) {
  const kind = isRecapSlug(slug) ? KIND_OF[slug] : null;
  const latest = useLatestRecapKey(kind ?? "monthly");
  if (!kind) return <Redirect to="/recaps" replace />;
  if (latest.isError)
    return (
      <Frame kind={kind}>
        <ErrorState error={latest.error} onRetry={() => latest.refetch()} />
      </Frame>
    );
  return latest.data ? <Redirect to={recapPath(kind, latest.data.key)} replace /> : <Frame kind={kind}>{<BodySkeleton />}</Frame>;
}

/** `/recaps/:id`, the old address of a recap, from links in Discord and Overview. */
export function RecapById({ id }: { id: number }) {
  const q = useDigest(id);
  if (q.data) return <Redirect to={recapPath(q.data.kind, q.data.periodKey)} replace />;
  const missing = q.error instanceof ApiError && q.error.status === 404;
  return (
    <Frame kind="monthly">
      {missing ? (
        <EmptyState size="page" icon={NewspaperIcon} title="This recap does not exist" action={<AppLink to="/recaps">Open Recaps</AppLink>} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <BodySkeleton />
      )}
    </Frame>
  );
}

function BodySkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-4/5" />
        <Skeleton className="h-4 w-48" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}

const yesterday = (timezone: string) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
};

/** Writes, completes or brings up to date one period's recap. With Claude ready it runs on the server as a run; without, it is a plain request. */
function useWriteRecap(kind: RecapKind, key: string) {
  const queryClient = useQueryClient();
  const gate = useClaudeGate({ needsSpotify: false });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["digests"] });
  const run = useRun<Digest>({ key: "/api/digests/generate", onDone: refresh });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const write = async () => {
    setProblem(null);
    if (gate.ready && !gate.blocked) {
      const done = await run.start("/api/digests/generate", { kind, key });
      if (done) refresh();
      return;
    }
    setBusy(true);
    try {
      await request("/api/digests/generate", { json: { kind, key } });
      refresh();
    } catch (error) {
      setProblem(assistantProblem(error));
    } finally {
      setBusy(false);
    }
  };
  return { gate, run, busy, problem: problem ?? run.problem, write, withClaude: gate.ready && !gate.blocked };
}

/** Writes the recap. While a run is going (also one resumed after leaving the page) it shows busy, with Cancel beside it. */
function WriteButton({ writer, label, variant, size }: { writer: ReturnType<typeof useWriteRecap>; label: string; variant?: "primary"; size?: "sm" }) {
  return (
    <div className="flex items-center gap-2">
      <Button variant={variant} size={size} busy={writer.busy || writer.run.running} busyLabel="Writing" onClick={() => void writer.write()}>
        {label}
      </Button>
      {writer.run.running && (
        <Button variant="ghost" size={size} onClick={writer.run.cancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

function Missing({ period }: { period: RecapPeriod }) {
  const writer = useWriteRecap(period.kind, period.key);
  if (period.reason === "before_history")
    return <EmptyState size="page" icon={NewspaperIcon} title={`Your history starts ${period.historyStart ? fmtDay(period.historyStart) : "later"}`} description={`There is nothing to recap for ${period.label}.`} />;
  if (period.reason === "not_ended") return <EmptyState size="page" icon={NewspaperIcon} title={`${period.label} is not over yet`} />;
  return (
    <div className="flex flex-col items-center gap-4">
      <EmptyState
        size="page"
        icon={NewspaperIcon}
        title={`No recap of ${period.label} yet`}
        description={period.inProgress ? `It covers ${fmtDayShort(period.from)} to ${fmtDayShort(period.to)} so far.` : undefined}
        action={<WriteButton writer={writer} variant="primary" label="Write the recap" />}
      />
      {writer.gate.blocked && <Notice tone="info">{writer.gate.blocked} Until then the recap shows the numbers alone.</Notice>}
      {writer.problem && <Notice tone="danger" onRetry={() => void writer.write()}>{writer.problem}</Notice>}
    </div>
  );
}

function Recap({ period, recap }: { period: RecapPeriod; recap: Digest }) {
  const timezone = useTimezone();
  const writer = useWriteRecap(period.kind, period.key);
  const page = recap.page;
  const wordless = recap.lines === null && page.legacyText === null;
  const behind = page.inProgress && recap.to < yesterday(timezone);
  const action = behind ? "Bring up to date" : wordless && writer.withClaude ? "Add Claude’s lines" : null;
  return (
    <>
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-display text-balance text-primary">{page.headline}</h1>
        <p className="text-secondary">
          {[
            page.inProgress ? `So far, to ${fmtDayShort(page.span.to)}` : null,
            page.compare ? `Compared with ${page.compare.label}` : null,
            `Written ${fmtDate(recap.createdAt, timezone)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {page.note && <p className="text-secondary text-pretty">{page.note}</p>}
        {(action || writer.run.running) && <WriteButton writer={writer} size="sm" label={action ?? "Write the recap"} />}
        {writer.problem && <Notice tone="danger">{writer.problem}</Notice>}
      </header>
      {page.quiet && <p className="text-secondary">Almost no listening this {NOUN[page.kind]}, so there is little to show.</p>}
      <RecapSections page={page} songsActions={<RecapPlaylistActions period={period} songs={page.sections.find((s) => s.id === "songs")?.songs ?? []} />} />
      {page.legacyText && (
        <Section title="As written then">
          <div className="max-w-[60ch] text-body whitespace-pre-line text-pretty text-secondary">{page.legacyText}</div>
        </Section>
      )}
    </>
  );
}

/** `/recaps/:kind/:key`: one period of the timeline. */
export function RecapPeriodPage({ slug, periodKey }: { slug: string; periodKey: string }) {
  const kind = isRecapSlug(slug) ? KIND_OF[slug] : null;
  const q = useRecapPeriod(kind ?? "monthly", periodKey);
  useDocumentTitle(q.data ? `Recap, ${q.data.label}` : "Recap");
  if (!kind) return <Redirect to="/recaps" replace />;
  const notFound = q.error instanceof ApiError && q.error.status === 404;
  const period = q.data;
  return (
    <Frame kind={kind} period={period}>
      {notFound ? (
        <EmptyState size="page" icon={NewspaperIcon} title="This recap does not exist" action={<AppLink to="/recaps">Open Recaps</AppLink>} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !period ? (
        <BodySkeleton />
      ) : (
        <div className={`${SECTIONS} ${dimWhile(q.isPlaceholderData)}`}>{period.recap ? <Recap key={period.key} period={period} recap={period.recap} /> : <Missing key={period.key} period={period} />}</div>
      )}
    </Frame>
  );
}
