import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { useLifetime, useSets } from "../api/queries";
import type { SetResult, SetSummary } from "../api/types";
import { fmtAgo, fmtInt } from "../lib/format";
import { useSetStarters } from "../lib/prompts";
import { useRun } from "../lib/useRun";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { useClaudeGate } from "../ui/ClaudeNotice";
import { Composer } from "../ui/Composer";
import { PlaylistIcon, WaveformIcon } from "../ui/icons";
import { Page, PageHeader, Section } from "../ui/Page";
import { RowSkeleton } from "../ui/Rows";
import { RunProgress } from "../ui/RunProgress";
import { Notice } from "../ui/Notice";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";

type SetListItem = SetSummary & { tracks: number };

function SetRow({ set }: { set: SetListItem }) {
  const detail = [set.version === 0 ? "Waiting for your answer" : `${fmtInt(set.tracks)} songs`, set.playlist && "saved to Spotify", fmtAgo(set.updatedAt)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <AppLink
        to={`/sets/${set.id}`}
        className="-mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-fill"
      >
        <Artwork src={set.coverUrl} kind="playlist" box={48} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-primary">{set.title}</span>
          <span className="truncate text-caption text-secondary tabular">{detail}</span>
        </span>
      </AppLink>
    </li>
  );
}

/** The prompt, the starters from the owner's own listening, and the run while Claude builds the set. */
function NewSet() {
  const [text, setText] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const starters = useSetStarters();
  const gate = useClaudeGate({ needsSpotify: true });
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const show = async (result: SetResult) => {
    queryClient.setQueryData(["sets", result.set.id], result.set);
    await queryClient.invalidateQueries({ queryKey: ["sets"], exact: true });
    navigate(`/sets/${result.set.id}`);
  };
  const run = useRun<SetResult>({ key: "/api/sets", onDone: show });

  const build = async () => {
    const request = text.trim();
    setAsked(request);
    setStopped(false);
    const result = await run.start("/api/sets", { request });
    if (result) await show(result);
  };

  if (run.running)
    return (
      <div className="flex flex-col gap-5">
        {asked && <p className="max-w-[60ch] text-body text-pretty">{asked}</p>}
        <RunProgress
          run={run}
          title="Building your set"
          onCancel={() => {
            run.cancel();
            setStopped(true);
          }}
        />
      </div>
    );
  return (
    <div className="flex flex-col gap-5">
      {run.problem && (
        <Notice tone="danger" onRetry={gate.blocked || !text.trim() ? undefined : build}>
          {run.problem}
        </Notice>
      )}
      {stopped && <p className="text-secondary">Stopped.</p>}
      <Composer
        label="Describe a set"
        placeholder="A late drive home, songs I finished at night, a few I’ve never heard"
        value={text}
        onChange={setText}
        onSubmit={build}
        disabled={Boolean(gate.blocked)}
        notice={gate.blocked ?? gate.warning}
        footer={gate.spend}
      />
      {starters.length > 0 && !gate.blocked && (
        <div className="flex flex-col gap-1">
          <h2 className="text-caption text-secondary">From your listening</h2>
          <ul className="flex flex-col">
            {starters.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="-mx-2 flex min-h-(--control-h) w-[calc(100%+16px)] items-center rounded-md px-2 py-2 text-left text-pretty transition-colors duration-150 hover:bg-fill"
                  onClick={() => setText(s)}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Sets: make a playlist from a prompt, and every set made so far. Primary action: make a set. */
export function Sets() {
  const q = useSets();
  const lifetime = useLifetime();
  const firstUse = lifetime.data !== undefined && !lifetime.data.firstPlayed;
  return (
    <Page width="read">
      <PageHeader title="Sets" />
      {firstUse ? (
        <FirstUseState icon={WaveformIcon} description="Sets are built from what you play. Import your history or connect Spotify first." />
      ) : (
        <>
          <NewSet />
          <Section title="Your sets">
            {q.isError ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : !q.data ? (
              <RowSkeleton rows={4} />
            ) : q.data.items.length === 0 ? (
              <EmptyState icon={PlaylistIcon} title="No sets yet" description="Describe a moment above and the set lands here." />
            ) : (
              <ul className="flex flex-col">
                {q.data.items.map((s) => (
                  <SetRow key={s.id} set={s} />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </Page>
  );
}
