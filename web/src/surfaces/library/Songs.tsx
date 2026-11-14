import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { request } from "../../api/client";
import { useLibraryAnalysis, useLibrarySongs } from "../../api/queries";
import { fmtInt } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { AppLink } from "../../ui/AppLink";
import { Button, buttonClass } from "../../ui/Button";
import { Page, PageHeader } from "../../ui/Page";
import { RowSkeleton } from "../../ui/Rows";
import { describeError, EmptyState, ErrorState } from "../../ui/States";
import { SongLine } from "./rows";
import { groupFromSearch, songGroupTitle, songs } from "./words";

const ACTION_LABEL = { songs: "Plan to archive these", duplicates: "Plan to remove the extra copies", unsaved: "Plan to like these" } as const;

/** The songs behind one figure of the overview, and the step that turns them into a plan to review. */
export function LibrarySongs() {
  const search = useSearch();
  const group = groupFromSearch(search);
  const analysisQuery = useLibraryAnalysis();
  const analysis = analysisQuery.data;
  const q = useLibrarySongs(group);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [making, setMaking] = useState(false);
  const playlist = group.kind !== "unsaved" && group.where !== "liked" ? analysis?.playlists.find((p) => p.id === group.where)?.name : undefined;
  const title = songGroupTitle(group, analysis?.rules, playlist);
  const crumb = q.isError ? null : group.kind === "unsaved" || analysis || analysisQuery.isError ? title : undefined;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total;

  const plan = async () => {
    setMaking(true);
    try {
      const { id } = await request<{ id: number }>("/api/library/plans", { json: { group } });
      await queryClient.invalidateQueries({ queryKey: ["library", "plans"] });
      navigate(`/library/plans/${id}`);
    } catch (error) {
      showToast(describeError(error), "problem");
      setMaking(false);
    }
  };

  return (
    <Page crumb={crumb}>
      <PageHeader
        title={title}
        description={total !== undefined && total > 0 ? songs(total) : undefined}
        actions={
          total !== undefined &&
          total > 0 && (
            <Button variant="primary" busy={making} busyLabel="Making the plan" onClick={() => void plan()}>
              {ACTION_LABEL[group.kind]}
            </Button>
          )
        }
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <RowSkeleton rows={10} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No songs here now"
          description="The library changed since this figure was counted."
          action={
            <AppLink to="/library" className={buttonClass()}>
              Back to the library
            </AppLink>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ul aria-label={title} className="flex flex-col">
            {items.map((s) => (
              <SongLine key={`${s.uri}:${s.where.kind === "playlist" ? s.where.id : ""}`} name={s.name} artist={s.artist} art={s.albumArtUrl} detail={group.kind === "duplicates" ? `${s.positions.length} copies. ${s.reason}` : s.reason} />
            ))}
          </ul>
          {q.hasNextPage && (
            <Button className="self-start" busy={q.isFetchingNextPage} busyLabel="Loading" onClick={() => void q.fetchNextPage()}>
              Show more ({fmtInt(items.length)} of {fmtInt(total ?? 0)})
            </Button>
          )}
        </div>
      )}
    </Page>
  );
}
