import { useState, type ReactNode } from "react";
import { useSkips, useSkipSplit } from "../api/queries";
import type { MomentClass, SkipProfile, Skips as SkipsData, SkipSplit } from "../api/types";
import { songPath } from "../app/paths";
import { DitherBars } from "../charts/Dither";
import { ContextRates, contextRates } from "../charts/ContextRates";
import { CLASS_LABELS, contextPhrase, fmtInt, fmtPct } from "../lib/format";
import { useRange, type Range } from "../lib/range";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { SkipForwardIcon } from "../ui/icons";
import { SECTIONS, Section, dimWhile } from "../ui/Page";
import { RangePicker } from "../ui/RangePicker";
import { RowSkeleton } from "../ui/Rows";
import { TabList, TabsRoot } from "../ui/Segmented";
import { ChartSkeleton, Skeleton } from "../ui/Skeleton";
import { SongContext, SongMenu } from "../ui/SongMenu";
import { Stat } from "../ui/Stat";
import { EmptyState, ErrorState } from "../ui/States";
import { StartSessionButton } from "../ui/StartSessionButton";
import { PatternsFrame } from "./PatternsFrame";

const CLASSES: MomentClass[] = ["wrong_moment", "keeper", "mixed", "dislike"];
const CLASS_LINE: Record<MomentClass, string> = {
  wrong_moment: "Played through in one context, skipped in another.",
  keeper: "Skipped on fewer than 1 in 4 plays.",
  mixed: "Skipped often, with no clear context.",
  dislike: "Skipped on 3 in 4 plays or more, in every context.",
};
const PAGE = 25;

function Figures({ summary }: { summary: SkipsData["summary"] }) {
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-6">
      <Stat item={{ id: "rate", label: "Plays skipped", value: fmtPct(summary.skipRate) }} />
      {summary.skips > 0 && <Stat item={{ id: "quick", label: "Skips in the first 5 seconds", value: fmtPct(summary.quickSkips / summary.skips) }} />}
    </div>
  );
}

function Positions({ positions }: { positions: SkipsData["positions"] }) {
  const total = positions.reduce((sum, p) => sum + p.skips, 0);
  if (total === 0) return null;
  const first = positions[0]!.skips / total;
  const last = positions[positions.length - 1]!.skips / total;
  const rows = positions.map((p) => ({ part: `${Math.round(p.start * 100)}–${Math.round(p.end * 100)}%`, skips: p.skips }));
  return (
    <Section
      title="Where in the song"
      description={`${fmtPct(first)} of skips come in the first tenth of a song, ${fmtPct(last)} in the last tenth.`}
    >
      <DitherBars
        label="Skips by how far into the song they came"
        rows={rows}
        xKey="part"
        tipLabel="part"
        valueKey="skips"
        valueLabel="Skips"
        xFormat={(v) => v}
        format={(v) => fmtInt(Math.round(v))}
        height={200}
      />
    </Section>
  );
}

function ContextGroups({ profile, plays, overall }: { profile: SkipProfile; plays: number; overall: number }) {
  const list = contextRates(profile, Math.max(30, plays * 0.01));
  if (list.length === 0) return null;
  const most = list.reduce((a, b) => (b.skipRate > a.skipRate ? b : a));
  const least = list.reduce((a, b) => (b.skipRate < a.skipRate ? b : a));
  return (
    <Section
      title="In what context"
      description={`Skipped most ${contextPhrase(most.dimension, most.value)} (${fmtPct(most.skipRate)}), least ${contextPhrase(least.dimension, least.value)} (${fmtPct(least.skipRate)}). The line marks the overall ${fmtPct(overall)}.`}
    >
      <ContextRates rates={list} overall={overall} />
    </Section>
  );
}

function SongRow({ song }: { song: SkipSplit["songs"][number] }) {
  const ref = { uri: song.uri, name: song.name, songKey: song.songKey, artist: song.artist };
  const why =
    song.class === "wrong_moment" && song.bestContext && song.worstContext
      ? `Plays through ${contextPhrase(song.bestContext.dimension, song.bestContext.value)} (${fmtPct(song.bestContext.skipRate)} skipped), skipped ${contextPhrase(song.worstContext.dimension, song.worstContext.value)} (${fmtPct(song.worstContext.skipRate)})`
      : null;
  return (
    <SongContext song={ref} render="li" className="group relative -mx-2 flex min-h-(--row-h) items-center gap-3 rounded-md px-2 py-2 transition-colors duration-150 hover:bg-fill">
      <AppLink to={songPath(song.songKey)} className="absolute inset-0 rounded-md" aria-label={`${song.name}, ${song.artist}`} />
      <Artwork src={song.albumArtUrl} kind="song" box={32} className="pointer-events-none self-start phone:size-10" />
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col">
        <span className="truncate text-primary">{song.name}</span>
        <span className="truncate text-caption text-secondary">{song.artist}</span>
        {why && <span className="mt-1 text-caption text-pretty text-primary">{why}</span>}
      </span>
      <span className="pointer-events-none flex shrink-0 flex-col items-end self-start">
        <span className="tabular">{fmtPct(song.skipRate)}</span>
        <span className="text-caption text-secondary tabular">of {fmtInt(song.plays)}</span>
      </span>
      <SongMenu song={ref} className="relative self-start md:opacity-0 md:transition-opacity md:duration-150 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[popup-open]:opacity-100" />
    </SongContext>
  );
}

function ClassSongs({ range, cls, onClass }: { range: Range; cls: MomentClass; onClass: (c: MomentClass) => void }) {
  const q = useSkipSplit(range, cls);
  const [limit, setLimit] = useState(PAGE);
  const counts = q.data?.counts;
  return (
    <Section title="Songs by pattern" description={q.data && q.data.eligibleSongs > 0 ? CLASS_LINE[cls] : undefined}>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div aria-busy className="flex flex-col gap-4">
          <Skeleton className="h-8 w-full max-w-lg" />
          <RowSkeleton rows={6} />
        </div>
      ) : q.data.eligibleSongs === 0 ? (
        <EmptyState size="inline" title="No song has enough plays with skip data" description={`A song needs ${q.data.params.minPlays} plays with skip data. A wider range adds more.`} />
      ) : (
        <TabsRoot
          value={cls}
          onValueChange={(v) => {
            onClass(v as MomentClass);
            setLimit(PAGE);
          }}
          className="flex flex-col gap-3"
        >
          <TabList<MomentClass>
            label="Pattern"
            className="hairline-b"
            options={CLASSES.map((c) => ({
              value: c,
              label: (
                <>
                  {CLASS_LABELS[c]} <span className="font-normal text-tertiary tabular">{fmtInt(counts![c])}</span>
                </>
              ),
            }))}
          />
          <div className={cx("flex flex-col gap-2", dimWhile(q.isPlaceholderData))}>
            {q.data.songs.length === 0 ? (
              <EmptyState size="inline" title={`No songs in ${CLASS_LABELS[cls].toLowerCase()} for this range`} />
            ) : (
              <ol aria-label={CLASS_LABELS[cls]} className="flex flex-col">
                {q.data.songs.slice(0, limit).map((s) => (
                  <SongRow key={s.songKey} song={s} />
                ))}
              </ol>
            )}
            {q.data.songs.length > limit && (
              <Button variant="ghost" className="-ml-3 self-start" onClick={() => setLimit((l) => l + 50)}>
                Show more
              </Button>
            )}
            {cls === "keeper" && <StartSessionButton uris={q.data.songs.map((s) => s.uri)} className="self-start" />}
          </div>
        </TabsRoot>
      )}
    </Section>
  );
}

function SkipsView({ range }: { range: Range }) {
  const q = useSkips(range);
  const [cls, setCls] = useState<MomentClass>("wrong_moment");
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <div aria-busy className="flex flex-col gap-8">
        <div className="flex gap-12">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <ChartSkeleton className="h-[248px]" />
      </div>
    );
  const { summary } = q.data;
  if (summary.plays === 0) return <EmptyState size="section" title="No plays in this range" description="Pick a wider range to see where songs get skipped." action={<RangePicker />} />;
  if (summary.skipRate === null)
    return (
      <EmptyState
        size="section"
        title="No skip data in this range"
        description="Skips come from the Spotify export and from plays encore saw live. Pick a range they cover."
        action={<RangePicker />}
      />
    );
  return (
    <div className={cx(SECTIONS, dimWhile(q.isPlaceholderData))}>
      <Figures summary={summary} />
      <Positions positions={q.data.positions} />
      <ContextGroups profile={q.data.profile} plays={summary.plays} overall={summary.skipRate} />
      <ClassSongs range={range} cls={cls} onClass={setCls} />
    </div>
  );
}

export function Skips(): ReactNode {
  const { range } = useRange();
  return (
    <PatternsFrame icon={SkipForwardIcon} firstUse="Once plays come in, this shows where in a song you skip and in what context.">
      <SkipsView range={range} />
    </PatternsFrame>
  );
}
