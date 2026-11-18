import { useState, type ReactNode } from "react";
import { useSkips, useSkipSplit } from "../api/queries";
import type { MomentClass, PlayOutcome, SkipProfile, Skips as SkipsData, SkipSplit } from "../api/types";
import { songPath } from "../app/paths";
import { ContextRates, contextRates } from "../charts/ContextRates";
import { RateMeter } from "../charts/RateMeter";
import { CLASS_LABELS, contextPhrase, fmtInt, fmtPct, OUTCOME_LABELS } from "../lib/format";
import { useRange, type Range } from "../lib/range";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { SkipForwardIcon } from "../ui/icons";
import { SECTIONS, Section, dimWhile } from "../ui/Page";
import { Stat } from "../ui/Stat";
import { RangePicker } from "../ui/RangePicker";
import { RowSkeleton } from "../ui/Rows";
import { TabList, TabsRoot } from "../ui/Segmented";
import { ChartSkeleton, Skeleton } from "../ui/Skeleton";
import { SongContext, SongMenu } from "../ui/SongMenu";
import { EmptyState, ErrorState } from "../ui/States";
import { StartSessionButton } from "../ui/StartSessionButton";
import { PatternsFrame } from "./PatternsFrame";
import { StartsSection } from "./skips/Starts";

const CLASSES: MomentClass[] = ["wrong_moment", "keeper", "mixed", "skipped_everywhere"];
const CLASS_LINE: Record<MomentClass, string> = {
  wrong_moment: "Played through in one context, skipped in another.",
  keeper: "Skipped on fewer than 1 in 4 plays.",
  mixed: "Skipped often, with no clear context.",
  skipped_everywhere: "Skipped on 3 in 4 plays or more, in every context.",
};
const OUTCOMES: PlayOutcome[] = ["through", "early", "midway", "interrupted"];
const PAGE = 25;

function Endings({ summary }: { summary: SkipsData["summary"] }) {
  const known = OUTCOMES.reduce((sum, o) => sum + summary.outcomes[o], 0);
  return (
    <Section
      title="How plays end"
      description={summary.skips > 0 ? `${fmtPct(summary.earlySkips / summary.skips)} of skips come in the first 30 seconds.` : undefined}
    >
      <ul className="flex max-w-xl flex-col">
        {OUTCOMES.map((o) => (
          <li key={o} className="grid h-(--row-h-compact) grid-cols-[minmax(0,8rem)_minmax(0,1fr)_2.75rem] items-center gap-3">
            <span className="truncate" title={`${fmtInt(summary.outcomes[o])} plays`}>
              {OUTCOME_LABELS[o]}
            </span>
            <RateMeter rate={summary.outcomes[o] / known} />
            <span className="text-right text-secondary tabular">{fmtPct(summary.outcomes[o] / known)}</span>
          </li>
        ))}
      </ul>
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
      <Artwork src={song.albumArtUrl} kind="song" box={40} className="pointer-events-none self-start" />
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col">
        <span className="truncate text-primary">{song.name}</span>
        <span className="truncate text-caption text-secondary">{song.artist}</span>
        {why && <span className="mt-1 text-caption text-pretty text-primary">{why}</span>}
      </span>
      <span className="pointer-events-none flex shrink-0 flex-col items-end self-start">
        <span className="tabular">{fmtPct(song.skipRate)}</span>
        <span className="text-caption text-secondary tabular">of {fmtInt(song.plays)}</span>
      </span>
      <SongMenu song={ref} className="relative self-start md:can-hover:opacity-0 md:transition-opacity md:duration-150 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[open]:opacity-100" />
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
        <EmptyState size="inline" title="No song has enough plays with a known ending" description={`A song needs ${q.data.params.minPlays} of them. A wider range adds more.`} />
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
        title="No play in this range has a known ending"
        description="Endings come from the Spotify export and from plays encore saw live. Pick a range they cover."
        action={<RangePicker />}
      />
    );
  return (
    <div className={cx(SECTIONS, dimWhile(q.isPlaceholderData))}>
      <Stat item={{ id: "rate", label: "Plays skipped", value: fmtPct(summary.skipRate) }} />
      <Endings summary={summary} />
      <StartsSection range={range} />
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
