import { useQueryClient } from "@tanstack/react-query";
import { request } from "../api/client";
import { useSearchParams } from "wouter";
import { useRadar } from "../api/queries";
import { Digests } from "./Digests";
import type { Release } from "../api/types";
import { fmtAgo, fmtDay, fmtInt } from "../lib/format";
import { showToast } from "../lib/toast";
import { usePlayback } from "../player/playback";
import { artistPath, AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Icon, PlayIcon } from "../ui/Icon";
import { Page } from "../ui/Page";
import { Segmented } from "../ui/Segmented";
import { Empty, ErrorState, Skeleton } from "../ui/states";

type View = "new" | "recent" | "digests";

const TYPE_LABELS: Record<Release["albumType"], string> = { album: "Album", single: "Single", compilation: "Compilation" };

function useMarkSeen() {
  const queryClient = useQueryClient();
  return async (ids?: string[]) => {
    try {
      await request("/api/radar/seen", { json: ids ? { ids } : {} });
      await queryClient.invalidateQueries({ queryKey: ["radar"] });
    } catch {
      showToast("Could not mark as seen. Try again.", "problem");
    }
  };
}

function ReleaseTile({ release, onSeen }: { release: Release; onSeen: () => void }) {
  const playback = usePlayback();
  const unseen = release.isNew && !release.seen;
  return (
    <li className="flex min-w-0 flex-col gap-2.5">
      <div className="group relative">
        <a href={release.url} target="_blank" rel="noreferrer" className="block" aria-label={`${release.name} on Spotify`}>
          <Artwork src={release.imageUrl} name={release.name} size="md" className="w-full rounded-lg" />
        </a>
        <button
          type="button"
          className="btn btn-icon btn-accent absolute right-2 bottom-2 shadow-default md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          aria-label={`Play ${release.name}`}
          onClick={() => playback.playContext(release.uri)}
        >
          <Icon icon={PlayIcon} size={16} />
        </button>
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-primary">
          {unseen && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="New" />}
          <span className="truncate">{release.name}</span>
        </span>
        <AppLink to={artistPath(release.artist)} className="truncate text-body-sm text-secondary hover-fine:text-primary">
          {release.artist}
        </AppLink>
        <span className="text-body-sm text-tertiary tabular">
          {TYPE_LABELS[release.albumType]} · {fmtDay(release.releaseDate)}
        </span>
      </div>
      {unseen && (
        <button type="button" className="btn btn-transparent -ml-3 self-start" onClick={onSeen}>
          Mark as seen
        </button>
      )}
    </li>
  );
}

function ReleaseGrid({ view }: { view: "new" | "recent" }) {
  const q = useRadar(view, 30);
  const markSeen = useMarkSeen();
  const d = q.data;
  return (
    <>
      {d && (
        <div className="-mt-6 flex flex-wrap items-center justify-between gap-3 md:-mt-10">
          <p className="text-body-sm text-secondary">
            Watching {fmtInt(d.artists)} artists you play often. {d.lastRunAt ? `Last checked ${fmtAgo(d.lastRunAt)}.` : "Not checked yet."}
          </p>
          {view === "new" && d.unseenNew > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => markSeen()}>
              Mark all as seen
            </button>
          )}
        </div>
      )}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !d ? (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <li key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-square w-full rounded-lg" />
              <Skeleton className="h-3.5 w-3/4" />
            </li>
          ))}
        </ul>
      ) : d.items.length === 0 ? (
        view === "new" ? (
          <Empty title="Nothing new">New releases from artists you play show up here once the radar finds them.</Empty>
        ) : (
          <Empty title="No releases in the last 30 days" />
        )
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-5">
          {d.items.map((r) => (
            <ReleaseTile key={r.id} release={r} onSeen={() => markSeen([r.id])} />
          ))}
        </ul>
      )}
    </>
  );
}

export default function Releases() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("view");
  const view: View = raw === "recent" || raw === "digests" ? raw : "new";
  return (
    <Page title="Releases">
      <Segmented
        label="Releases"
        value={view}
        onChange={(v) => setParams(v === "new" ? {} : { view: v }, { replace: true })}
        options={[
          { value: "new", label: "New" },
          { value: "recent", label: "Last 30 days" },
          { value: "digests", label: "Digests" },
        ]}
      />
      {view === "digests" ? <Digests /> : <ReleaseGrid view={view} />}
    </Page>
  );
}
