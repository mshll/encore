import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { useSets } from "../api/queries";
import type { SetResult, SetSummary } from "../api/types";
import { fmtAgo, fmtInt } from "../lib/format";
import { useSetStarters } from "../lib/prompts";
import { useRun } from "../lib/useRun";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Composer } from "../ui/Composer";
import { Page, Section } from "../ui/Page";
import { RunProgress } from "../ui/RunProgress";
import { Empty, ErrorState, Skeleton } from "../ui/states";

export function SetCover({ covers, title, className = "" }: { covers: string[]; title: string; className?: string }) {
  if (covers.length < 4) return <Artwork src={covers[0]} name={title} size="md" className={`rounded-lg ${className}`} />;
  return (
    <span aria-hidden className={`grid aspect-square shrink-0 grid-cols-2 overflow-hidden rounded-lg ${className}`}>
      {covers.slice(0, 4).map((src) => (
        <Artwork key={src} src={src} className="size-full rounded-none" />
      ))}
    </span>
  );
}

function SetTile({ set }: { set: SetSummary & { tracks: number; covers: string[] } }) {
  return (
    <li>
      <AppLink to={`/sets/${set.id}`} className="group flex flex-col gap-2.5">
        <SetCover
          covers={set.covers}
          title={set.title}
          className="w-full transition-transform duration-200 ease-(--ease-out-quint) group-active:scale-[0.98]"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{set.title}</span>
          <span className="truncate text-body-sm text-secondary tabular">
            {set.version === 0 ? "Waiting for your answer" : `${fmtInt(set.tracks)} songs`} · {fmtAgo(set.updatedAt)}
          </span>
        </span>
      </AppLink>
    </li>
  );
}

function NewSet() {
  const [text, setText] = useState("");
  const run = useRun<SetResult>();
  const starters = useSetStarters();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const build = async (request: string) => {
    const result = await run.start("/api/sets", { request });
    if (!result) return;
    await queryClient.invalidateQueries({ queryKey: ["sets"] });
    queryClient.setQueryData(["sets", result.set.id], result.set);
    navigate(`/sets/${result.set.id}`);
  };

  if (run.running) return <RunProgress run={run} title="Building your set" onCancel={run.cancel} />;
  return (
    <div className="flex flex-col gap-4">
      <Composer
        label="Describe a moment"
        placeholder="A late drive home, songs I finished at night, a few I’ve never heard"
        value={text}
        onChange={setText}
        onSubmit={() => build(text.trim())}
        action="Build set"
        rows={3}
        autoFocus
      />
      {run.problem && (
        <p role="alert" className="text-danger">
          {run.problem}
        </p>
      )}
      {starters.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-body-sm text-secondary">Or start from your own listening</p>
          <ul className="flex flex-col">
            {starters.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="-mx-2 w-full rounded-lg px-2 py-2 text-left text-pretty transition-colors hover-fine:bg-transparent-hover"
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

export default function Sets() {
  const q = useSets();
  return (
    <Page title="Sets">
      <div className="max-w-2xl">
        <NewSet />
      </div>
      <Section title="Your sets">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-lg" />
            ))}
          </div>
        ) : q.data.items.length === 0 ? (
          <Empty title="No sets yet">Describe a moment above and the set lands here.</Empty>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-5">
            {q.data.items.map((s) => (
              <SetTile key={s.id} set={s} />
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
