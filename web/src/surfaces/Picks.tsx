import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import { request } from "../api/client";
import { useLifetime, usePickWeeks, usePicks, useStatus } from "../api/queries";
import type { Pick, PicksWeek, PickState } from "../api/types";
import { artistPath } from "../app/paths";
import { FOR_YOU_TABS } from "../app/nav";
import { assistantProblem } from "../lib/assistant";
import { fmtDayShort, fmtHour, fmtInt, fmtPct, WEEKDAYS } from "../lib/format";
import { showToast } from "../lib/toast";
import { useRun } from "../lib/useRun";
import { openInSpotify, usePlayback } from "../player/playback";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button, buttonClass, IconButton } from "../ui/Button";
import { useClaudeGate } from "../ui/ClaudeNotice";
import { cx } from "../ui/cx";
import { Icon } from "../ui/Icon";
import {
  ArrowCounterClockwiseIcon,
  ArrowUpRightIcon,
  DotsThreeIcon,
  MicrophoneStageIcon,
  PlayIcon,
  ProhibitIcon,
  QueueIcon,
  SparkleIcon,
  WaveformIcon,
} from "../ui/icons";
import { MenuItem, MenuLinkItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "../ui/Menu";
import { Page, PageHeader, Section, dimWhile } from "../ui/Page";
import { RunProgress } from "../ui/RunProgress";
import { Select } from "../ui/Select";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { BlockedList } from "./BlockedList";
import { Notice } from "../ui/Notice";
import { TabNav } from "../ui/TabNav";

const STATE_TEXT: Record<Exclude<PickState, "new">, string> = { saved: "Saved", not_now: "Not now", never: "Never again" };

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`;

function useSetPickState() {
  const queryClient = useQueryClient();
  const send = async (pick: Pick, state: PickState) => {
    try {
      await request(`/api/picks/${pick.id}`, { method: "PATCH", json: { state } });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["picks"] }), queryClient.invalidateQueries({ queryKey: ["blocks"] })]);
      return true;
    } catch (error) {
      showToast(assistantProblem(error), "problem");
      return false;
    }
  };
  return async (pick: Pick, state: PickState) => {
    const previous = pick.state;
    if (!(await send(pick, state))) return;
    if (state === "never") showToast(`“${pick.name}” won’t be suggested again.`, "info", { label: "Undo", onClick: () => void send(pick, previous) });
  };
}

function outcomeLine(p: Pick): string | null {
  const o = p.outcome;
  if (o.plays === 0) return o.inLibrary ? "In your library, not played yet" : null;
  return [
    `Played ${plural(o.plays, "time", "times")} on ${plural(o.playDays, "day", "days")}, ${fmtInt(o.finished)} finished`,
    o.inLibrary && "in your library",
    o.hit && "kept",
  ]
    .filter(Boolean)
    .join(", ");
}

function PickRow({ pick }: { pick: Pick }) {
  const playback = usePlayback();
  const setState = useSetPickState();
  const [, navigate] = useLocation();
  const meta = [pick.album, pick.releaseDate?.slice(0, 4), pick.distance === "far" ? "Further from what you play" : null].filter(Boolean).join(" · ");
  const outcome = outcomeLine(pick);
  return (
    <li className="group flex gap-4 py-5 first:pt-0 md:gap-5">
      <Artwork src={pick.albumArtUrl} kind="song" box={64} className="phone:size-12" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium text-primary">{pick.name}</span>
            <span className="line-clamp-2 text-caption text-secondary">
              <AppLink to={artistPath(pick.artist)} className="-my-1 py-1 hover:text-primary hover:underline">
                {pick.artist}
              </AppLink>
              {meta && ` · ${meta}`}
            </span>
          </div>
          <div className="-mt-1 flex shrink-0 items-center gap-1">
            {pick.state === "new" ? (
              <Button size="sm" onClick={() => setState(pick, "saved")}>
                Save
              </Button>
            ) : (
              <span className="px-1 text-caption text-secondary">{STATE_TEXT[pick.state]}</span>
            )}
            <IconButton icon={PlayIcon} label={`Play ${pick.name}`} size="sm" className="max-md:hidden" onClick={() => playback.play([pick.uri])} />
            <MenuRoot>
              <MenuTrigger
                className={buttonClass({ variant: "ghost", size: "sm", className: "touch-target size-(--control-h-sm) px-0" })}
                aria-label={`More for ${pick.name}`}
              >
                <Icon icon={DotsThreeIcon} size="md" />
              </MenuTrigger>
              <MenuPopup>
                <MenuItem icon={PlayIcon} onClick={() => playback.play([pick.uri])}>
                  Play
                </MenuItem>
                <MenuItem icon={QueueIcon} onClick={() => playback.queue(pick.uri, pick.name)}>
                  Add to queue
                </MenuItem>
                <MenuSeparator />
                {pick.state === "new" ? (
                  <>
                    <MenuItem icon={SparkleIcon} onClick={() => setState(pick, "not_now")}>
                      Not now
                    </MenuItem>
                    <MenuItem icon={ProhibitIcon} onClick={() => setState(pick, "never")}>
                      Never suggest again
                    </MenuItem>
                  </>
                ) : (
                  <MenuItem icon={ArrowCounterClockwiseIcon} onClick={() => setState(pick, "new")}>
                    Undo “{STATE_TEXT[pick.state]}”
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem icon={MicrophoneStageIcon} onClick={() => navigate(artistPath(pick.artist))}>
                  Go to artist
                </MenuItem>
                <MenuLinkItem icon={ArrowUpRightIcon} href={openInSpotify(pick.uri)} target="_blank" rel="noreferrer">
                  Open in Spotify
                </MenuLinkItem>
              </MenuPopup>
            </MenuRoot>
          </div>
        </div>
        <p className="max-w-[60ch] text-body text-pretty text-primary">{pick.reason}</p>
        {(pick.source || outcome) && (
          <div className="flex flex-col gap-1 text-caption text-secondary">
            {pick.source && (
              <a href={pick.source.url} target="_blank" rel="noreferrer" className="-my-1 flex max-w-full items-center gap-1 self-start py-1 hover:text-primary">
                <span className="truncate">{pick.source.title}</span>
                <Icon icon={ArrowUpRightIcon} className="shrink-0" />
              </a>
            )}
            {outcome && <span className="tabular">{outcome}</span>}
          </div>
        )}
      </div>
    </li>
  );
}

function PicksSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-8">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-5">
          <Skeleton className="size-16 phone:size-12" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

const nextRun = (slot: { weekday: number; hour: number }) => `${WEEKDAYS[slot.weekday - 1]} at ${fmtHour(slot.hour)}`;

/** This week has no picks: the scheduled time, and making them now as a server-owned run. */
function Generate() {
  const status = useStatus();
  const gate = useClaudeGate({ needsSpotify: true });
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["picks"] });
  const run = useRun<PicksWeek>({ key: "/api/picks/generate", onDone: refresh });
  const [stopped, setStopped] = useState(false);
  const generate = async () => {
    setStopped(false);
    if (await run.start("/api/picks/generate", {})) await refresh();
  };
  if (run.running)
    return (
      <RunProgress
        run={run}
        title="Choosing picks"
        onCancel={() => {
          run.cancel();
          setStopped(true);
        }}
      />
    );
  const schedule = status.data?.llm.schedule;
  return (
    <div className="flex flex-col gap-4">
      {run.problem && (
<Notice tone="danger">{run.problem}</Notice>
      )}
      <EmptyState
        icon={SparkleIcon}
        title="No picks this week yet"
        description={gate.blocked ?? gate.warning ?? (stopped ? "Stopped." : schedule?.enabled ? `Claude picks them on ${nextRun(schedule.picks)}.` : undefined)}
        action={
          <Button variant="primary" disabled={Boolean(gate.blocked)} onClick={generate}>
            Pick this week’s songs
          </Button>
        }
      />
    </div>
  );
}

function HowPicksDid({ stats }: { stats: PicksWeek["stats"] }) {
  if (stats.settled === 0) return null;
  return (
    <Section title="How picks did">
      <p className="max-w-[60ch] text-body text-pretty">
        Of {plural(stats.settled, "pick", "picks")} older than a week, you played {fmtInt(stats.played)} and kept{" "}
        <span className="font-medium tabular">{fmtInt(stats.hits)}</span> ({fmtPct(stats.hitRate)}): finished, then played again on another day or saved.
      </p>
    </Section>
  );
}


function WeekPicker({ current, value, onChange }: { current: string; value: string; onChange: (week: string) => void }) {
  const weeks = usePickWeeks();
  const list = weeks.data?.items.map((w) => w.week) ?? [];
  const all = list.includes(current) ? list : [current, ...list];
  if (all.length < 2) return null;
  return (
    <Select
      label="Week"
      value={value}
      onChange={onChange}
      options={all.map((w) => ({ value: w, label: w === current ? "This week" : `Week of ${fmtDayShort(w)}` }))}
      className="phone:w-full"
    />
  );
}

/** For you: Picks. What Claude picked this week, why, and how earlier weeks went. Primary action: play the picks. */
export function Picks() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("week") ?? undefined;
  const q = usePicks(asked);
  const thisWeek = usePicks();
  const lifetime = useLifetime();
  const playback = usePlayback();
  const current = thisWeek.data?.week;
  const week = q.data?.week;
  const isCurrent = Boolean(week && week === current);
  const firstUse = lifetime.data !== undefined && !lifetime.data.firstPlayed;
  const pickWeek = (w: string) => setParams(w === current ? {} : { week: w }, { replace: true });

  return (
    <Page width="read">
      <PageHeader title="For you" actions={current && week && !firstUse && <WeekPicker current={current} value={week} onChange={pickWeek} />}>
        <TabNav items={FOR_YOU_TABS} label="For you" />
      </PageHeader>
      {firstUse ? (
        <FirstUseState icon={WaveformIcon} description="Picks are chosen from what you play. Import your history or connect Spotify first." />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <PicksSkeleton />
      ) : (
        <>
          <section aria-labelledby="picks-title" className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
              <div className="flex min-w-0 flex-col">
                <h2 id="picks-title" className="text-heading font-medium">
                  {isCurrent ? "This week" : `Week of ${fmtDayShort(q.data.week)}`}
                </h2>
                {q.data.picks.length > 0 && (
                  <p className="text-secondary tabular">
                    {plural(q.data.picks.length, "song", "songs")} new to you, {fmtInt(q.data.picks.filter((p) => p.outcome.plays > 0).length)} played so far
                  </p>
                )}
              </div>
              {q.data.picks.length > 0 && (
                <Button variant="accent" icon={PlayIcon} className="phone:w-full" onClick={() => playback.play(q.data.picks.map((p) => p.uri))}>
                  Play picks
                </Button>
              )}
            </div>
            {q.data.picks.length > 0 ? (
              <ol className={cx("flex flex-col divide-y-[0.5px] divide-line", dimWhile(q.isPlaceholderData))}>
                {q.data.picks.map((p) => (
                  <PickRow key={p.id} pick={p} />
                ))}
              </ol>
            ) : isCurrent ? (
              <Generate />
            ) : (
              <EmptyState title="No picks that week" />
            )}
          </section>
          <HowPicksDid stats={q.data.stats} />
          <BlockedList />
        </>
      )}
    </Page>
  );
}
