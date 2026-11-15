import { useLifetime, useSets } from "../api/queries";
import type { SetSummary } from "../api/types";
import { useChat } from "../chat/state";
import { fmtAgo, fmtInt } from "../lib/format";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button } from "../ui/Button";
import { PlaylistIcon, PlusIcon, WaveformIcon } from "../ui/icons";
import { Page, PageHeader, Section } from "../ui/Page";
import { RowSkeleton } from "../ui/Rows";
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

/** Sets: every set made so far. Primary action: make a set, in the chat. */
export function Sets() {
  const q = useSets();
  const chat = useChat();
  const make = () => chat.show({ thread: null, mode: "set" });
  const lifetime = useLifetime();
  const firstUse = lifetime.data !== undefined && !lifetime.data.firstPlayed;
  return (
    <Page width="read">
      <PageHeader
        title="Sets"
        actions={
          !firstUse && (
            <Button variant="primary" icon={PlusIcon} onClick={make}>
              Make a set
            </Button>
          )
        }
      />
      {firstUse ? (
        <FirstUseState icon={WaveformIcon} description="Sets are built from what you play. Import your history or connect Spotify first." />
      ) : (
        <>
          <Section title="Your sets">
            {q.isError ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : !q.data ? (
              <RowSkeleton rows={4} />
            ) : q.data.items.length === 0 ? (
              <EmptyState icon={PlaylistIcon} title="No sets yet" />
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
