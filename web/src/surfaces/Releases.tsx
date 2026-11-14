import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useSearchParams } from "wouter";
import { request } from "../api/client";
import { useLifetime, useRadar } from "../api/queries";
import type { Release } from "../api/types";
import { FOR_YOU_TABS } from "../app/nav";
import { artistPath } from "../app/paths";
import { fmtAgo, fmtDay, fmtInt } from "../lib/format";
import { showToast } from "../lib/toast";
import { usePlayback } from "../player/playback";
import { Artwork } from "../ui/Artwork";
import { Button, IconButton } from "../ui/Button";
import { cx } from "../ui/cx";
import { ArrowUpRightIcon, CheckIcon, MicrophoneStageIcon, PlayIcon, VinylRecordIcon, WaveformIcon } from "../ui/icons";
import { MenuItem, MenuLinkItem, MenuPopup, MenuRoot, MoreTrigger } from "../ui/Menu";
import { Page, PageHeader, dimWhile } from "../ui/Page";
import { RowSkeleton } from "../ui/Rows";
import { Segmented } from "../ui/Segmented";
import { EmptyState, ErrorState, FirstUseState } from "../ui/States";
import { TabNav } from "../ui/TabNav";

type View = "new" | "recent";

const TYPE_LABELS: Record<Release["albumType"], string> = { album: "Album", single: "Single", compilation: "Compilation" };

function useMarkSeen() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const mark = async (key: string, ids?: string[]) => {
    setBusy(key);
    try {
      await request("/api/radar/seen", { json: ids ? { ids } : {} });
      await queryClient.invalidateQueries({ queryKey: ["radar"] });
    } catch {
      showToast("Could not mark as seen. Try again.", "problem");
    } finally {
      setBusy(null);
    }
  };
  return { mark, busy };
}

function ReleaseRow({ release, view, onSeen, busy }: { release: Release; view: View; onSeen: () => void; busy: boolean }) {
  const playback = usePlayback();
  const [, navigate] = useLocation();
  const unseen = release.isNew && !release.seen;
  const tracks = release.albumType === "single" && release.totalTracks === 1 ? null : `${fmtInt(release.totalTracks)} songs`;
  const meta = [view === "recent" && unseen ? "New" : null, release.artist, TYPE_LABELS[release.albumType], tracks, fmtDay(release.releaseDate)].filter(Boolean).join(" · ");
  return (
    <li className="group -mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-fill">
      <Artwork src={release.imageUrl} kind="album" box={48} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-primary">{release.name}</span>
        <span className="truncate text-caption text-secondary">{meta}</span>
      </span>
      {view === "new" && unseen && (
        <Button size="sm" variant="ghost" busy={busy} busyLabel="Marking" onClick={onSeen} className="phone:hidden">
          Mark seen
        </Button>
      )}
      <IconButton icon={PlayIcon} label={`Play ${release.name}`} size="sm" onClick={() => playback.playContext(release.uri)} />
      <MenuRoot>
        <MoreTrigger label={`More for ${release.name}`} />
        <MenuPopup>
          <MenuItem icon={PlayIcon} onClick={() => playback.playContext(release.uri)}>
            Play
          </MenuItem>
          {view === "new" && unseen && (
            <MenuItem icon={CheckIcon} onClick={onSeen} className="md:hidden">
              Mark seen
            </MenuItem>
          )}
          <MenuItem icon={MicrophoneStageIcon} onClick={() => navigate(artistPath(release.artist))}>
            Go to artist
          </MenuItem>
          <MenuLinkItem icon={ArrowUpRightIcon} href={release.url} target="_blank" rel="noreferrer">
            Open in Spotify
          </MenuLinkItem>
        </MenuPopup>
      </MenuRoot>
    </li>
  );
}

/** For you: Releases. What artists the owner plays released lately. Mark seen, play. */
export function Releases() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "recent" ? "recent" : "new";
  const q = useRadar(view, 30);
  const lifetime = useLifetime();
  const { mark, busy } = useMarkSeen();
  const firstUse = lifetime.data !== undefined && !lifetime.data.firstPlayed;
  const setView = (v: View) => setParams(v === "new" ? {} : { view: v }, { replace: true });
  const d = q.data;

  return (
    <Page width="read">
      <PageHeader title="For you">
        <TabNav items={FOR_YOU_TABS} label="For you" />
      </PageHeader>
      {firstUse ? (
        <FirstUseState icon={WaveformIcon} description="Releases are watched for the artists you play. Import your history or connect Spotify first." />
      ) : (
        <section aria-label="Releases" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="Releases"
              value={view}
              onChange={setView}
              options={[
                { value: "new", label: "New" },
                { value: "recent", label: "Last 30 days" },
              ]}
            />
            {view === "new" && d && d.unseenNew > 1 && (
              <Button size="sm" busy={busy === "all"} busyLabel="Marking" onClick={() => mark("all")}>
                Mark all seen
              </Button>
            )}
          </div>
          {d && d.artists > 0 && (
            <p className="text-caption text-secondary">
              Watching {fmtInt(d.artists)} artists you play often{d.lastRunAt ? `, checked ${fmtAgo(d.lastRunAt)}` : ""}
            </p>
          )}
          {q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !d ? (
            <RowSkeleton rows={5} />
          ) : d.items.length === 0 ? (
            view === "new" ? (
              <EmptyState
                icon={VinylRecordIcon}
                title="Nothing new"
                description={d.lastRunAt ? "New songs and albums from artists you play show up here." : "The release check has not run yet."}
                action={
                  <Button size="sm" onClick={() => setView("recent")}>
                    Show the last 30 days
                  </Button>
                }
              />
            ) : (
              <EmptyState icon={VinylRecordIcon} title="No releases in the last 30 days" />
            )
          ) : (
            <ul className={cx("flex flex-col", dimWhile(q.isPlaceholderData))}>
              {d.items.map((r) => (
                <ReleaseRow key={r.id} release={r} view={view} busy={busy === r.id} onSeen={() => mark(r.id, [r.id])} />
              ))}
            </ul>
          )}
        </section>
      )}
    </Page>
  );
}
