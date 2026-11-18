import { useState, type ReactNode } from "react";
import { Redirect, useLocation } from "wouter";
import { ApiError } from "../api/client";
import { useDigest, useLatestRecapKey, useLifetime, useRecapPeriod, useRecapTimeline, useTimezone } from "../api/queries";
import type { Digest, RecapKind, RecapPeriod } from "../api/types";
import { recapPath, RECAP_SLUGS, type RecapSlug } from "../app/paths";
import { fmtDate, fmtDay, fmtDayShort } from "../lib/format";
import { AppLink } from "../ui/AppLink";
import { Button, IconButton } from "../ui/Button";
import { Dialog, DialogClose } from "../ui/Dialog";
import { CaretLeftIcon, CaretRightIcon, NewspaperIcon } from "../ui/icons";
import { Notice } from "../ui/Notice";
import { dimWhile, Page, PageHeader, SECTIONS, useDocumentTitle, type HeaderAction } from "../ui/Page";
import { Segmented } from "../ui/Segmented";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { RecapPlaylistActions } from "./recaps/Playlist";
import { RecapSections } from "./recaps/Sections";
import { ShareRecap } from "./recaps/Share";
import { Timeline } from "./recaps/Timeline";
import { useWriteRecap, type RecapWriter } from "./recaps/write";

const KIND_OF: Record<RecapSlug, RecapKind> = { week: "weekly", month: "monthly", year: "yearly" };
const KIND_OPTIONS = (Object.entries(RECAP_SLUGS) as [RecapKind, RecapSlug][]).map(([, slug]) => ({ value: slug, label: slug === "week" ? "Week" : slug === "month" ? "Month" : "Year" }));
const NOUN: Record<RecapKind, string> = { weekly: "week", monthly: "month", yearly: "year" };

const isRecapSlug = (slug: string): slug is RecapSlug => slug in KIND_OF;

function TimelineSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-10">
      {[0, 1].map((group) => (
        <div key={group} className="flex flex-col gap-3">
          <Skeleton className="h-8 w-24" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** `/recaps`: every period the history reaches, the ones still going first. */
export function Recaps() {
  const timeline = useRecapTimeline();
  const lifetime = useLifetime();
  const writer = useWriteRecap();
  useDocumentTitle("Recaps");
  const firstUse = (lifetime.data && !lifetime.data.firstPlayed) || (timeline.data && timeline.data.historyStart === null);
  return (
    <Page>
      <PageHeader title="Recaps" />
      {firstUse ? (
        <FirstUseState icon={NewspaperIcon} description="Recaps of each week, month and year appear here once your listening is imported." />
      ) : timeline.isError ? (
        <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} />
      ) : !timeline.data ? (
        <TimelineSkeleton />
      ) : (
        <Timeline timeline={timeline.data} writer={writer} />
      )}
    </Page>
  );
}

/** Week, Month and Year, then the arrows to the period before and after. The title names the period, so the arrows carry no label of their own. */
function PeriodNav({ kind, period }: { kind: RecapKind; period?: RecapPeriod }) {
  const [, navigate] = useLocation();
  return (
    <div className="flex items-center gap-3">
      <Segmented label="Recap length" value={RECAP_SLUGS[kind]} onChange={(slug) => navigate(`/recaps/${slug}`)} options={KIND_OPTIONS} className="md:w-60" />
      <nav aria-label={`Other ${NOUN[kind]}s`} className="flex shrink-0 items-center gap-1">
        <IconButton
          icon={CaretLeftIcon}
          label={period?.previous ? `Previous ${NOUN[kind]}` : `No earlier ${NOUN[kind]}`}
          variant="ghost"
          disabled={!period?.previous}
          onClick={() => period?.previous && navigate(recapPath(kind, period.previous))}
        />
        <IconButton
          icon={CaretRightIcon}
          label={period?.next ? `Next ${NOUN[kind]}` : `No later ${NOUN[kind]}`}
          variant="ghost"
          disabled={!period?.next}
          onClick={() => period?.next && navigate(recapPath(kind, period.next))}
        />
      </nav>
    </div>
  );
}

/**
 * Every recap address renders in the page frame. `title` names the page (the period, or "Recap" before one is known);
 * undefined shows a skeleton while it loads. `crumb` is the period in the trail.
 */
function Frame({ kind, period, title, crumb, secondary, children }: { kind: RecapKind; period?: RecapPeriod; title?: string; crumb?: string | null; secondary?: HeaderAction[]; children: ReactNode }) {
  return (
    <Page crumb={crumb}>
      {title ? (
        <PageHeader title={title} secondary={secondary}>
          <PeriodNav kind={kind} period={period} />
        </PageHeader>
      ) : (
        <header aria-busy className="flex flex-col gap-4">
          <Skeleton className="h-9 w-56" />
          <PeriodNav kind={kind} period={period} />
        </header>
      )}
      {children}
    </Page>
  );
}

/** `/recaps/week` and friends: the newest period of that length that has ended. */
export function RecapKindLatest({ slug }: { slug: string }) {
  const kind = isRecapSlug(slug) ? KIND_OF[slug] : null;
  const latest = useLatestRecapKey(kind ?? "monthly");
  if (!kind) return <Redirect to="/recaps" replace />;
  if (latest.isError)
    return (
      <Frame kind={kind} title="Recaps" crumb={null}>
        <ErrorState error={latest.error} onRetry={() => latest.refetch()} />
      </Frame>
    );
  return latest.data ? (
    <Redirect to={recapPath(kind, latest.data.key)} replace />
  ) : (
    <Frame kind={kind}>
      <BodySkeleton />
    </Frame>
  );
}

/** `/recaps/:id`, the old address of a recap, from links in Discord. */
export function RecapById({ id }: { id: number }) {
  const q = useDigest(id);
  if (q.data) return <Redirect to={recapPath(q.data.kind, q.data.periodKey)} replace />;
  const missing = q.error instanceof ApiError && q.error.status === 404;
  return (
    <Frame kind="monthly" title={q.isError ? "Recap" : undefined} crumb={q.isError ? null : undefined}>
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
    <div aria-busy className="flex max-w-(--measure) flex-col gap-10">
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

/** Writes the recap. While a run is going (also one resumed after leaving the page) it shows busy, with Cancel beside it. */
function WriteButton({ writer, period, label, variant, size }: { writer: RecapWriter; period: RecapPeriod; label: string; variant?: "primary"; size?: "sm" }) {
  const busy = writer.writing(period.kind, period.key);
  return (
    <div className="flex items-center gap-2">
      <Button variant={variant} size={size} busy={busy} busyLabel={writer.canWrite ? "Writing" : "Making"} disabled={writer.working && !busy} onClick={() => void writer.write(period.kind, period.key)}>
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
  const writer = useWriteRecap();
  if (period.reason === "before_history")
    return <EmptyState size="page" icon={NewspaperIcon} title={`Your history starts ${period.historyStart ? fmtDay(period.historyStart) : "later"}`} description={`There is nothing to recap for ${period.label}.`} />;
  if (period.reason === "not_ended") return <EmptyState size="page" icon={NewspaperIcon} title={`${period.label} has not started yet`} />;
  return (
    <div className="flex flex-col items-center gap-4">
      <EmptyState
        size="page"
        icon={NewspaperIcon}
        title={`No recap of ${period.label} yet`}
        description={period.inProgress ? `It covers ${fmtDayShort(period.from)} to ${fmtDayShort(period.to)} so far.` : undefined}
        action={<WriteButton writer={writer} period={period} variant="primary" label={writer.canWrite ? "Write it" : "Show the figures"} />}
      />
      {writer.problem && (
        <Notice tone="danger" onRetry={() => void writer.write(period.kind, period.key)}>
          {writer.problem}
        </Notice>
      )}
    </div>
  );
}

const yesterday = (timezone: string) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
};

function Recap({ period, recap }: { period: RecapPeriod; recap: Digest }) {
  const timezone = useTimezone();
  const writer = useWriteRecap();
  const page = recap.page;
  const wordless = recap.lines === null && page.legacyText === null;
  const behind = page.inProgress && recap.to < yesterday(timezone);
  const action = behind ? "Bring up to date" : wordless && writer.canWrite ? "Write it" : null;
  return (
    <>
      <div className="flex max-w-(--measure) flex-col gap-3">
        <p className="font-display text-display text-balance text-primary [overflow-wrap:anywhere]">{page.headline}</p>
        <p className="text-secondary">
          {[page.inProgress ? `So far, to ${fmtDayShort(page.span.to)}` : null, page.compare ? `Compared with ${page.compare.label}` : null, `Made ${fmtDate(recap.createdAt, timezone)}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {page.note && <p className="text-secondary text-pretty">{page.note}</p>}
        {(action || writer.working) && <WriteButton writer={writer} period={period} size="sm" label={action ?? "Write it"} />}
        {writer.problem && <Notice tone="danger">{writer.problem}</Notice>}
      </div>
      {page.quiet && <p className="text-secondary">Almost no listening this {NOUN[page.kind]}, so there is little to show.</p>}
      <RecapSections page={page} songsActions={<RecapPlaylistActions period={period} songs={page.sections.find((s) => s.id === "songs")?.songs ?? []} />} />
    </>
  );
}

/** The text a recap from before recaps were pages was written as, kept reachable from the header. */
function WrittenThen({ text, open, onOpenChange }: { text: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Text written then" footer={<DialogClose render={<Button variant="ghost">Done</Button>} />}>
      <div className="text-body whitespace-pre-line text-pretty text-primary">{text}</div>
    </Dialog>
  );
}

/** `/recaps/:kind/:key`: one period of the timeline. */
export function RecapPeriodPage({ slug, periodKey }: { slug: string; periodKey: string }) {
  const kind = isRecapSlug(slug) ? KIND_OF[slug] : null;
  const q = useRecapPeriod(kind ?? "monthly", periodKey);
  const [sharing, setSharing] = useState(false);
  const [reading, setReading] = useState(false);
  const period = q.data;
  const title = period ? (period.inProgress ? `${period.label} so far` : period.label) : undefined;
  useDocumentTitle(title ? `Recap, ${title}` : "Recap");
  if (!kind) return <Redirect to="/recaps" replace />;
  const notFound = q.error instanceof ApiError && q.error.status === 404;
  const recap = period?.recap;
  const legacyText = recap?.page.legacyText ?? null;
  const secondary: HeaderAction[] = [];
  if (recap) secondary.push({ label: "Share", onClick: () => setSharing(true) });
  if (legacyText) secondary.push({ label: "Text written then", onClick: () => setReading(true) });
  return (
    <Frame kind={kind} period={period} title={title ?? (q.isError ? "Recap" : undefined)} crumb={period?.label ?? (q.isError ? null : undefined)} secondary={secondary.length ? secondary : undefined}>
      {notFound ? (
        <EmptyState size="page" icon={NewspaperIcon} title="This recap does not exist" action={<AppLink to="/recaps">Open Recaps</AppLink>} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !period ? (
        <BodySkeleton />
      ) : (
        <div className={`${SECTIONS} ${dimWhile(q.isPlaceholderData)}`}>{recap ? <Recap key={period.key} period={period} recap={recap} /> : <Missing key={period.key} period={period} />}</div>
      )}
      {recap && <ShareRecap recap={recap} open={sharing} onOpenChange={setSharing} />}
      {legacyText && <WrittenThen text={legacyText} open={reading} onOpenChange={setReading} />}
    </Frame>
  );
}
