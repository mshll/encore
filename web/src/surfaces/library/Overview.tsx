import { useLibraryAnalysis, useStatus, useTimezone } from "../../api/queries";
import type { LibraryAnalysis } from "../../api/types";
import { songPath } from "../../app/paths";
import { useWidth } from "../../charts/core";
import { DitherStack } from "../../charts/Dither";
import { RateMeter } from "../../charts/RateMeter";
import { fmtDate, fmtInt, fmtMonth, fmtMonthLong, fmtMonthShort, fmtPct } from "../../lib/format";
import { AppLink } from "../../ui/AppLink";
import { buttonClass } from "../../ui/Button";
import { BroomIcon } from "../../ui/icons";
import { Section, SIDE_COLUMNS } from "../../ui/Page";
import { Row, RowList, RowSkeleton } from "../../ui/Rows";
import { ChartSkeleton, Skeleton } from "../../ui/Skeleton";
import { EmptyState, ErrorState } from "../../ui/States";
import { cellClass, TableHead, useColumns, type Column } from "../../ui/Table";
import { LibraryFrame } from "./LibraryFrame";
import { FigureRow } from "./rows";
import { classLabel, PLAY_CLASSES, songs, songsPath } from "./words";

const GONE = ["dormant", "never"] as const;
const gone = (c: { dormant: number; never: number }) => c.dormant + c.never;

const linkClass = "relative inline-flex min-h-6 min-w-6 items-center justify-end rounded-xs underline decoration-line-strong underline-offset-2 hover:text-primary hover:decoration-current";

function Liked({ a }: { a: LibraryAnalysis }) {
  const { total, classes } = a.liked;
  const out = gone(classes);
  return (
    <Section title="Liked songs" labelledBy="liked">
      <p className="text-secondary text-pretty">
        <span className="font-display text-title text-primary tabular">{fmtInt(out)}</span> of {fmtInt(total)} not played in{" "}
        {Math.round(a.rules.dormantAfterDays / 30)} months or more
      </p>
      <RowList label="Liked songs by last play">
        {PLAY_CLASSES.map((c) => (
          <FigureRow
            key={c}
            to={songsPath({ kind: "songs", where: "liked", classes: [c] })}
            title={classLabel(c, a.rules)}
            subtitle={c === "never" && a.historyStart ? `Since ${fmtMonthLong(a.historyStart.slice(0, 7))}` : undefined}
            value={fmtInt(classes[c])}
            share={classes[c] / Math.max(1, ...PLAY_CLASSES.map((k) => classes[k]))}
          />
        ))}
      </RowList>
    </Section>
  );
}

function SavedMonths({ a }: { a: LibraryAnalysis }) {
  const rows = a.savedMonths.map((m) => ({ month: m.month, label: fmtMonth(m.month), played: m.active + m.fading, gone: gone(m) }));
  const top = [...a.savedMonths].sort((x, y) => gone(y) - gone(x)).slice(0, 3).filter((m) => gone(m) > 0);
  if (rows.length < 2 || top.length === 0) return null;
  const most = top[0]!;
  return (
    <Section title="When you liked them" labelledBy="saved-months">
      <p className="text-secondary text-pretty">
        Most of the songs you no longer play were liked in {fmtMonthLong(most.month)} ({fmtInt(gone(most))}).
      </p>
      <DitherStack
        label="Liked songs by month liked"
        rows={rows}
        xKey="month"
        tipLabel="label"
        series={[
          { key: "played", label: "Still played", color: "blue" },
          { key: "gone", label: "No longer played", color: "green" },
        ]}
        xFormat={(m, i) => (i === 0 || m.endsWith("-01") ? fmtMonth(m) : fmtMonthShort(m))}
        format={fmtInt}
        height={200}
      />
      <RowList label="Months with the most songs you no longer play">
        {top.map((m) => (
          <FigureRow
            key={m.month}
            to={songsPath({ kind: "songs", where: "liked", classes: [...GONE], savedMonth: m.month })}
            title={`Liked in ${fmtMonthLong(m.month)}`}
            subtitle={`${fmtInt(m.active + m.fading + gone(m))} liked that month`}
            value={fmtInt(gone(m))}
          />
        ))}
      </RowList>
    </Section>
  );
}

const PLAYLIST_COLUMNS: Column[] = [
  { id: "name", label: "Playlist", width: "minmax(0,2fr)" },
  { id: "songs", label: "Songs", width: "64px", align: "end" },
  { id: "played", label: "Played in the last 3 months", width: "minmax(0,1.4fr)", from: "md" },
  { id: "last", label: "Last played", width: "112px", from: "lg", align: "end" },
  { id: "copies", label: "Extra copies", width: "96px", align: "end", from: "md" },
  { id: "overlap", label: "Shares the most with", width: "minmax(0,1.2fr)", from: "xl" },
];

function Playlists({ a }: { a: LibraryAnalysis }) {
  const timezone = useTimezone();
  const [ref, width] = useWidth<HTMLDivElement>();
  const table = width >= 560;
  const { visible, style } = useColumns(PLAYLIST_COLUMNS, width);
  const recent = Math.round(a.rules.fadingAfterDays / 30);
  return (
    <Section title="Playlists" labelledBy="playlists">
      <div ref={ref} role="table" aria-label="Your playlists" className="flex flex-col">
        {a.playlists.length === 0 ? (
          <EmptyState title="No playlists of your own" description="Playlists you made in Spotify show here after the next sync." />
        ) : (
          <>
            {table && <TableHead columns={visible} style={style} />}
            {[...a.playlists].sort((x, y) => x.classes.active / Math.max(1, x.songs) - y.classes.active / Math.max(1, y.songs)).map((p) => {
              const played = p.songs ? p.classes.active / p.songs : 0;
              const cells: Record<string, React.ReactNode> = {
                name: <span className="truncate text-primary">{p.name}</span>,
                songs: <span className="text-secondary tabular">{fmtInt(p.songs)}</span>,
                played: (
                  <span className="flex w-full items-center gap-3">
                    <RateMeter rate={played} className="w-full max-w-40" />
                    <span className="w-10 shrink-0 text-right text-secondary tabular">{fmtPct(played)}</span>
                  </span>
                ),
                last: <span className="text-secondary tabular">{p.lastPlayed ? fmtDate(p.lastPlayed, timezone) : "Never"}</span>,
                copies:
                  p.duplicates > 0 ? (
                    <AppLink to={songsPath({ kind: "duplicates", where: p.id })} className={`${linkClass} text-secondary tabular`}>
                      {fmtInt(p.duplicates)}
                    </AppLink>
                  ) : (
                    <span className="text-tertiary tabular">0</span>
                  ),
                overlap: p.overlap ? (
                  <span className="truncate text-secondary">
                    {p.overlap.name} <span className="tabular">({fmtInt(p.overlap.shared)})</span>
                  </span>
                ) : (
                  <span className="text-tertiary">None</span>
                ),
              };
              return (
                <div key={p.id} role="row" className="group relative -mx-2 rounded-md px-2 transition-colors duration-150 hover:bg-fill">
                  <AppLink to={songsPath({ kind: "songs", where: p.id })} className="absolute inset-0 rounded-md" aria-label={`${p.name}: ${songs(p.songs)}`} />
                  {table ? (
                    <div className="pointer-events-none grid min-h-(--row-h) items-center gap-4 [&_a]:pointer-events-auto" style={style}>
                      {visible.map((c) => (
                        <span key={c.id} role="cell" className={cellClass(c, "flex min-w-0 items-center" + (c.align === "end" ? " justify-end" : ""))}>
                          {cells[c.id]}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="pointer-events-none flex min-h-(--row-h) flex-col justify-center py-2 [&_a]:pointer-events-auto">
                      <span className="truncate text-primary">{p.name}</span>
                      <span className="text-caption text-pretty text-secondary">
                        {songs(p.songs)}, {fmtPct(played)} played in the last {recent} months
                        {p.duplicates > 0 && (
                          <>
                            ,{" "}
                            <AppLink to={songsPath({ kind: "duplicates", where: p.id })} className={linkClass}>
                              {fmtInt(p.duplicates)} extra {p.duplicates === 1 ? "copy" : "copies"}
                            </AppLink>
                          </>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </Section>
  );
}

function Artists({ a }: { a: LibraryAnalysis }) {
  const top = a.artists.filter((x) => gone(x) > 0);
  if (top.length === 0) return null;
  const max = gone(top[0]!);
  return (
    <Section title="By artist" description="Liked songs you no longer play" labelledBy="artists">
      <RowList label="Artists with the most liked songs you no longer play">
        {top.map((x) => (
          <FigureRow
            key={x.artist}
            to={songsPath({ kind: "songs", where: "liked", classes: [...GONE], artist: x.artist })}
            title={x.artist}
            subtitle={`${fmtInt(x.total)} liked`}
            value={fmtInt(gone(x))}
            share={gone(x) / max}
          />
        ))}
      </RowList>
    </Section>
  );
}

function Unsaved({ a }: { a: LibraryAnalysis }) {
  const { total, songs } = a.unsaved;
  if (total === 0) return null;
  return (
    <Section
      title="Played a lot, not liked"
      description={`${fmtInt(a.rules.unsavedMinListens)} listens or more`}
      labelledBy="unsaved"
      actions={
        <AppLink to={songsPath({ kind: "unsaved" })} className={buttonClass({ variant: "ghost", size: "sm" })}>
          See all {fmtInt(total)}
        </AppLink>
      }
    >
      <RowList label="Songs played a lot but not liked">
        {songs.map((s) => (
          <Row
            key={s.songKey}
            to={songPath(s.songKey)}
            title={s.name}
            subtitle={s.artist}
            art={{ src: s.albumArtUrl, kind: "song" }}
            value={fmtInt(s.listens)}
            song={{ uri: s.uri, name: s.name, songKey: s.songKey, artist: s.artist }}
          />
        ))}
      </RowList>
    </Section>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-hidden className={SIDE_COLUMNS}>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <RowSkeleton rows={4} />
        <ChartSkeleton className="h-50" />
      </div>
      <RowSkeleton rows={8} />
    </div>
  );
}

/** The state of the liked songs and playlists. Every figure opens its songs, and the songs page makes a plan. */
export function LibraryOverview() {
  const q = useLibraryAnalysis();
  const status = useStatus().data;
  const a = q.data;
  const unsynced = a && !a.library.lastSyncAt && a.library.savedTracks === 0 && a.library.playlists === 0;
  return (
    <LibraryFrame>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !a ? (
        <OverviewSkeleton />
      ) : unsynced ? (
        <EmptyState
          size="page"
          icon={BroomIcon}
          title={a.library.syncing ? "Your library is syncing" : "Your library has not synced yet"}
          description={
            status && !status.spotify.connected
              ? "encore reads your liked songs and playlists once Spotify is connected."
              : "encore reads your liked songs and playlists on its next sync."
          }
          action={
            status &&
            !status.spotify.connected && (
              <AppLink to="/settings/spotify" className={buttonClass({ variant: "primary" })}>
                Connect Spotify
              </AppLink>
            )
          }
        />
      ) : a.liked.total === 0 && a.playlists.length === 0 ? (
        <EmptyState size="page" icon={BroomIcon} title="No liked songs or playlists" description="Like songs or make playlists in Spotify and they show here after the next sync." />
      ) : (
        <div className={`${SIDE_COLUMNS} @min-[700px]/page:[&>section]:col-span-2`}>
          <div className="flex min-w-0 flex-col gap-10 md:gap-12">
            <Liked a={a} />
            <SavedMonths a={a} />
          </div>
          <div className="flex min-w-0 flex-col gap-10 md:gap-12">
            <Artists a={a} />
            <Unsaved a={a} />
          </div>
          <Playlists a={a} />
        </div>
      )}
    </LibraryFrame>
  );
}
