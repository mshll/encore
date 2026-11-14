import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, request } from "../api/client";
import { useBlocks, usePickWeeks, usePicks, useStatus } from "../api/queries";
import type { Pick, PicksWeek, PickState } from "../api/types";
import { assistantProblem } from "../lib/assistant";
import { fmtDay, fmtHour, fmtInt, fmtPct, WEEKDAYS } from "../lib/format";
import { showToast } from "../lib/toast";
import { useRun } from "../lib/useRun";
import { usePlayback } from "../player/playback";
import { AppLink, artistPath } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { ArrowUpRight01Icon, Icon, PlayIcon, PlayListIcon } from "../ui/Icon";
import { Page, Section } from "../ui/Page";
import { RunProgress } from "../ui/RunProgress";
import { Empty, ErrorState, Skeleton } from "../ui/states";

const STATE_TEXT: Record<Exclude<PickState, "new">, string> = { saved: "Saved", not_now: "Not now", never: "Never again" };

function usePickState() {
  const queryClient = useQueryClient();
  return async (pick: Pick, state: PickState) => {
    try {
      await request(`/api/picks/${pick.id}`, { method: "PATCH", json: { state } });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["picks"] }), queryClient.invalidateQueries({ queryKey: ["blocks"] })]);
      if (state === "never") showToast(`${pick.name} won’t be suggested again. Unblock it under Blocked.`);
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    }
  };
}

function outcomeLine(p: Pick) {
  const o = p.outcome;
  if (o.plays === 0) return o.inLibrary ? "In your library, not played yet" : "Not played yet";
  const days = o.playDays === 1 ? "on 1 day" : `on ${o.playDays} days`;
  return [`Played ${o.plays} ${o.plays === 1 ? "time" : "times"} ${days}, ${o.finished} finished`, o.inLibrary && "in your library", o.hit && "kept"]
    .filter(Boolean)
    .join(", ");
}

function PickCard({ pick }: { pick: Pick }) {
  const playback = usePlayback();
  const setState = usePickState();
  return (
    <li className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)] md:gap-8">
      <Artwork src={pick.albumArtUrl} name={pick.name} size="lg" className="w-full max-w-[360px] rounded-xl shadow-large" />
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-body-sm text-secondary">{pick.distance === "far" ? "Further out" : "Close to what you play"}</p>
          <h2 className="text-heading-5 font-semibold text-balance">{pick.name}</h2>
          <p className="text-secondary">
            <AppLink to={artistPath(pick.artist)} className="hover-fine:text-primary">
              {pick.artist}
            </AppLink>
            {pick.album && ` · ${pick.album}`}
            {pick.releaseDate && ` · ${pick.releaseDate.slice(0, 4)}`}
          </p>
        </div>
        <p className="max-w-2xl text-body-lg text-pretty">{pick.reason}</p>
        {pick.source && (
          <a
            href={pick.source.url}
            target="_blank"
            rel="noreferrer"
            className="flex max-w-full items-center gap-1 self-start text-body-sm text-secondary hover-fine:text-primary"
          >
            <span className="truncate">{pick.source.title}</span>
            <Icon icon={ArrowUpRight01Icon} size={16} />
          </a>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-accent" onClick={() => playback.play([pick.uri])}>
            <Icon icon={PlayIcon} size={16} />
            Play
          </button>
          <button
            type="button"
            className="btn btn-icon btn-secondary"
            aria-label={`Add ${pick.name} to the queue`}
            onClick={() => playback.queue(pick.uri, pick.name)}
          >
            <Icon icon={PlayListIcon} size={16} />
          </button>
          {pick.state === "new" ? (
            <div className="flex items-center gap-2 max-sm:basis-full">
              <button type="button" className="btn btn-secondary" onClick={() => setState(pick, "saved")}>
                Save
              </button>
              <button type="button" className="btn btn-transparent" onClick={() => setState(pick, "not_now")}>
                Not now
              </button>
              <button type="button" className="btn btn-transparent" onClick={() => setState(pick, "never")}>
                Never
              </button>
            </div>
          ) : (
            <span className="flex items-center gap-1 text-body-sm">
              <span className="font-medium">{STATE_TEXT[pick.state]}</span>
              <button type="button" className="btn btn-transparent" onClick={() => setState(pick, "new")}>
                Undo
              </button>
            </span>
          )}
        </div>
        {pick.outcome.plays > 0 && <p className="text-body-sm text-secondary">{outcomeLine(pick)}</p>}
      </div>
    </li>
  );
}

function nextRun(slot: { weekday: number; hour: number }) {
  return `${WEEKDAYS[slot.weekday - 1]} at ${fmtHour(slot.hour)}`;
}

function ThisWeek({ week }: { week: PicksWeek }) {
  const status = useStatus();
  const queryClient = useQueryClient();
  const run = useRun<PicksWeek>();
  const generate = async () => {
    const result = await run.start("/api/picks/generate", {});
    if (result) await queryClient.invalidateQueries({ queryKey: ["picks"] });
  };
  if (week.picks.length > 0)
    return (
      <ol className="flex flex-col gap-14">
        {week.picks.map((p) => (
          <PickCard key={p.id} pick={p} />
        ))}
      </ol>
    );
  if (run.running) return <RunProgress run={run} title="Choosing this week’s picks" onCancel={run.cancel} />;
  const schedule = status.data?.llm.schedule;
  return (
    <div className="flex flex-col gap-3">
      <Empty title="No picks this week yet">
        {schedule?.enabled ? `They arrive on ${nextRun(schedule.picks)}.` : "Generate them now, or turn scheduled runs on with JOBS_ENABLED."}
      </Empty>
      <button type="button" className="btn btn-primary self-start" onClick={generate}>
        Generate
      </button>
      {run.problem && (
        <p role="alert" className="text-danger">
          {run.problem}
        </p>
      )}
    </div>
  );
}

function PastWeeks({ current }: { current: string }) {
  const weeks = usePickWeeks();
  const past = (weeks.data?.items ?? []).filter((w) => w.week !== current);
  const details = useQueries({ queries: past.map((w) => ({ queryKey: ["picks", w.week], queryFn: () => get<PicksWeek>("/api/picks", { week: w.week }) })) });
  const [open, setOpen] = useState<string | null>(null);
  if (!weeks.data) return <Skeleton className="h-24 w-full" />;
  if (past.length === 0) return <p className="text-secondary">No earlier weeks yet.</p>;
  return (
    <ol className="flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-border-default">
      {past.map((w, i) => {
        const picks = details[i]?.data?.picks;
        const hits = picks?.filter((p) => p.outcome.hit).length;
        const expanded = open === w.week;
        return (
          <li key={w.week} className="flex flex-col gap-3 py-3">
            <button
              type="button"
              className="flex items-baseline justify-between gap-4 text-left"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : w.week)}
            >
              <span className="font-medium">Week of {fmtDay(w.week)}</span>
              <span className="text-body-sm text-secondary tabular">
                {w.played} of {w.picks} played{hits !== undefined && `, ${hits} kept`}
              </span>
            </button>
            {expanded && picks && (
              <ul className="flex flex-col gap-2 pb-2">
                {picks.map((p) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <Artwork src={p.albumArtUrl} name={p.name} className="size-10" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {p.name} <span className="font-normal text-secondary">· {p.artist}</span>
                      </span>
                      <span className="truncate text-body-sm text-secondary">
                        {p.state !== "new" && `${STATE_TEXT[p.state]}. `}
                        {outcomeLine(p)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Blocked() {
  const q = useBlocks();
  const queryClient = useQueryClient();
  const unblock = async (id: number) => {
    try {
      await request(`/api/blocks/${id}`, { method: "DELETE" });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["blocks"] }), queryClient.invalidateQueries({ queryKey: ["picks"] })]);
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    }
  };
  if (!q.data || q.data.items.length === 0) return null;
  return (
    <Section title="Blocked">
      <ul className="flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-border-default">
        {q.data.items.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-4 py-2.5">
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{b.label}</span>
              <span className="text-body-sm text-secondary">{b.kind === "artist" ? "Artist, never suggested" : "Song, never suggested"}</span>
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => unblock(b.id)}>
              Unblock
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export default function Picks() {
  const q = usePicks();
  const stats = q.data?.stats;
  return (
    <Page title="Picks">
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div className="grid gap-5 md:grid-cols-[240px_minmax(0,1fr)] md:gap-8">
          <Skeleton className="aspect-square w-full max-w-[360px] rounded-xl" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      ) : (
        <>
          <p className="-mt-6 text-secondary md:-mt-10">Week of {fmtDay(q.data.week)}</p>
          <ThisWeek week={q.data} />
          <Section title="Earlier weeks">
            {stats && stats.settled > 0 && (
              <p className="text-body-lg text-pretty">
                Of {fmtInt(stats.settled)} picks older than a week, you played {fmtInt(stats.played)} and kept{" "}
                <strong className="font-semibold tabular">{fmtInt(stats.hits)}</strong> ({fmtPct(stats.hitRate)}): finished, then played again on another day or
                saved.
              </p>
            )}
            <PastWeeks current={q.data.week} />
          </Section>
          <Blocked />
        </>
      )}
    </Page>
  );
}
