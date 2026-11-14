import { useState } from "react";
import { useSkips, useSkipSplit } from "../api/queries";
import type { MomentClass, SkipSplit } from "../api/types";
import { SegmentedBar } from "../charts/SegmentedBar";
import { CLASS_LABELS, contextPhrase, fmtInt, fmtPct } from "../lib/format";
import { useRange } from "../lib/range";
import { Artwork } from "../ui/Artwork";
import { SongContext, SongMenu, StartSessionButton } from "../ui/SongMenu";
import { AppLink, artistPath, songPath } from "../ui/AppLink";
import { Page, Section } from "../ui/Page";
import { Row, RowList } from "../ui/rows";
import { Segmented } from "../ui/Segmented";
import { Empty, ErrorState, Skeleton, SkeletonRows } from "../ui/states";

export const CLASS_ORDER: MomentClass[] = ["keeper", "wrong_moment", "mixed", "dislike"];

export const CLASS_STYLE: Record<MomentClass, { color: string; ink: string }> = {
  keeper: { color: "var(--gray-12)", ink: "var(--page)" },
  wrong_moment: { color: "var(--accent)", ink: "var(--on-accent)" },
  mixed: { color: "var(--gray-6)", ink: "var(--fg-primary)" },
  dislike: { color: "var(--gray-9)", ink: "#fff" },
};

export const CLASS_HINT: Record<MomentClass, string> = {
  keeper: "Skipped on under a quarter of plays.",
  wrong_moment: "Finished in one context, skipped in another.",
  mixed: "Skipped often, with no clear pattern.",
  dislike: "Skipped three times in four or more, everywhere.",
};

function SplitSongs({ cls }: { cls: MomentClass }) {
  const { range } = useRange();
  const q = useSkipSplit(range, cls);
  const [limit, setLimit] = useState(25);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <SkeletonRows rows={8} />;
  const songs = q.data.songs;
  if (songs.length === 0)
    return (
      <Empty title={`No ${CLASS_LABELS[cls].toLowerCase()} songs in this range`}>
        Songs need 8 plays with skip data to be classified. A wider range adds more.
      </Empty>
    );
  return (
    <div className={`flex flex-col gap-2 ${q.isPlaceholderData ? "opacity-60" : ""}`}>
      <ol className="flex flex-col [&>li+li]:border-t-[0.5px] [&>li+li]:border-border-default">
        {songs.slice(0, limit).map((s) => (
          <SongContext key={s.songKey} song={{ uri: s.uri, name: s.name }} className="group flex items-start gap-1">
            <AppLink
              to={songPath(s.songKey)}
              className="-mx-2 flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150 hover-fine:bg-transparent-hover"
            >
              <Artwork src={s.albumArtUrl} name={s.name} className="size-11 md:size-10" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{s.name}</span>
                <span className="truncate text-body-sm text-secondary">{s.artist}</span>
                {cls === "wrong_moment" && s.bestContext && s.worstContext && (
                  <span className="mt-1 text-body-sm text-primary text-pretty">
                    Plays through {contextPhrase(s.bestContext.dimension, s.bestContext.value)} ({fmtPct(s.bestContext.skipRate)} skipped), skipped{" "}
                    {contextPhrase(s.worstContext.dimension, s.worstContext.value)} ({fmtPct(s.worstContext.skipRate)})
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="tabular">{fmtPct(s.skipRate)}</span>
                <span className="text-body-sm text-secondary tabular">{fmtInt(s.plays)} plays</span>
              </span>
            </AppLink>
            <SongMenu
              song={{ uri: s.uri, name: s.name }}
              className="mt-2 max-md:hidden md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[popup-open]:opacity-100"
            />
          </SongContext>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        {songs.length > limit && (
          <button type="button" className="btn btn-transparent -ml-3" onClick={() => setLimit((l) => l + 50)}>
            Show more
          </button>
        )}
        {cls === "keeper" && <StartSessionButton uris={songs.map((s) => s.uri)} />}
      </div>
    </div>
  );
}

function Split({ data, cls, onClass }: { data: SkipSplit; cls: MomentClass; onClass: (c: MomentClass) => void }) {
  const total = data.eligibleSongs;
  return (
    <div className="flex flex-col gap-5">
      <SegmentedBar
        label="Skipped songs by pattern"
        format={(v, share) => `${fmtInt(v)} songs, ${Math.round(share * 100)}%`}
        segments={CLASS_ORDER.map((c) => ({ id: c, label: CLASS_LABELS[c], value: data.counts[c], ...CLASS_STYLE[c] }))}
      />
      <div role="tablist" aria-label="Pattern" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {CLASS_ORDER.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={cls === c}
            onClick={() => onClass(c)}
            className={`press flex flex-col items-start gap-1 rounded-xl p-3 text-left transition-colors duration-150 ${cls === c ? "bg-component" : "hover-fine:bg-transparent-hover"}`}
          >
            <span className="flex items-center gap-2 font-medium">
              <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: CLASS_STYLE[c].color }} />
              {CLASS_LABELS[c]}
            </span>
            <span className="text-heading-6 font-semibold tabular">
              {fmtInt(data.counts[c])} <span className="text-body-sm font-normal text-secondary">of {fmtInt(total)} songs</span>
            </span>
            <span className="text-body-sm text-secondary text-pretty">{CLASS_HINT[c]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

type ListKey = "never" | "quick" | "artists" | "most";

function SkipLists() {
  const { range } = useRange();
  const q = useSkips(range);
  const [list, setList] = useState<ListKey>("never");
  const [limit, setLimit] = useState(15);
  return (
    <Section title="Skip lists">
      <Segmented<ListKey>
        label="Skip list"
        value={list}
        onChange={(v) => {
          setList(v);
          setLimit(15);
        }}
        options={[
          { value: "never", label: "Never skipped" },
          { value: "quick", label: "Skipped within 5 s" },
          { value: "artists", label: "By artist" },
          { value: "most", label: "Most skipped" },
        ]}
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className={`flex flex-col gap-2 ${q.isPlaceholderData ? "opacity-60" : ""}`}>
          <RowList>
            {list === "never" &&
              q.data.neverSkipped
                .slice(0, limit)
                .map((s) => (
                  <Row
                    key={s.songKey}
                    to={songPath(s.songKey)}
                    art={{ src: s.albumArtUrl }}
                    song={{ uri: s.uri, name: s.name }}
                    title={s.name}
                    subtitle={s.artist}
                    value={`${fmtInt(s.plays)} plays`}
                  />
                ))}
            {list === "quick" &&
              q.data.quickSkips
                .slice(0, limit)
                .map((s) => (
                  <Row
                    key={s.songKey}
                    to={songPath(s.songKey)}
                    art={{ src: s.albumArtUrl }}
                    song={{ uri: s.uri, name: s.name }}
                    title={s.name}
                    subtitle={s.artist}
                    value={`${fmtInt(s.quickSkips)} times`}
                    detail={`of ${fmtInt(s.plays)} plays`}
                  />
                ))}
            {list === "artists" &&
              q.data.mostSkippedArtists
                .slice(0, limit)
                .map((a) => (
                  <Row
                    key={a.artist}
                    to={artistPath(a.artist)}
                    art={{ src: a.imageUrl, round: true }}
                    title={a.artist}
                    value={`${fmtPct(a.skipRate)} skipped`}
                    detail={`${fmtInt(a.plays)} plays`}
                  />
                ))}
            {list === "most" &&
              q.data.mostSkippedTracks
                .slice(0, limit)
                .map((s) => (
                  <Row
                    key={s.songKey}
                    to={songPath(s.songKey)}
                    art={{ src: s.albumArtUrl }}
                    song={{ uri: s.uri, name: s.name }}
                    title={s.name}
                    subtitle={s.artist}
                    value={`${fmtPct(s.skipRate)} skipped`}
                    detail={`${fmtInt(s.plays)} plays`}
                  />
                ))}
          </RowList>
          {limit < 100 && (
            <button type="button" className="btn btn-transparent -ml-3 self-start" onClick={() => setLimit(100)}>
              Show more
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

export default function Skips() {
  const { range } = useRange();
  const [cls, setCls] = useState<MomentClass>("wrong_moment");
  const split = useSkipSplit(range, cls);
  const skips = useSkips(range);
  const summary = skips.data?.summary;
  return (
    <Page title="Skips" ranged>
      <div className="flex flex-col gap-3">
        {!summary ? (
          <Skeleton className="h-14 w-72" />
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-heading-2 font-semibold md:text-heading-1">{fmtPct(summary.skipRate)}</span>
            <span className="text-heading-6 font-medium text-secondary">of plays skipped</span>
          </p>
        )}
        <p className="max-w-2xl text-body-lg text-secondary text-pretty">
          A skip is not always a dislike.
          {split.data && split.data.eligibleSongs > 0 && (
            <>
              {" "}
              <strong className="font-semibold text-primary tabular">{fmtInt(split.data.counts.wrong_moment)}</strong> songs play through in one context and get
              skipped in another.
            </>
          )}
        </p>
      </div>
      <Section title="Why songs get skipped">
        {split.isError ? (
          <ErrorState error={split.error} onRetry={() => split.refetch()} />
        ) : !split.data ? (
          <div className="flex flex-col gap-5">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : split.data.eligibleSongs === 0 ? (
          <Empty title="Not enough plays in this range">Songs need 8 plays with skip data to be classified. Pick a wider range.</Empty>
        ) : (
          <div className={split.isPlaceholderData ? "opacity-60" : ""}>
            <Split data={split.data} cls={cls} onClass={setCls} />
          </div>
        )}
        {split.data && split.data.eligibleSongs > 0 && <SplitSongs cls={cls} />}
      </Section>
      <SkipLists />
    </Page>
  );
}
