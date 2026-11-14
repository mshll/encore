import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../api/client";
import { useDj, useTimezone, useTracks } from "../api/queries";
import type { DjSession, TrackIdentity } from "../api/types";
import { fmtAgo, fmtInt, fmtTime } from "../lib/format";
import { showToast } from "../lib/toast";
import { playbackProblem } from "../player/playback";
import { AppLink, songPath } from "../ui/AppLink";
import { Page, Section } from "../ui/Page";
import { Row, RowList } from "../ui/rows";
import { Empty, ErrorState, SkeletonRows } from "../ui/states";

const END_REASONS: Record<NonNullable<DjSession["endReason"]>, string> = {
  stopped: "You stopped it",
  replaced: "A new session replaced it",
  left_playlist: "Spotify played something outside the session",
};

function TrackRow({ uri, track, rank, value }: { uri: string; track?: TrackIdentity; rank?: number; value?: string }) {
  if (!track) return <Row rank={rank} title="Song not in encore yet" subtitle={uri} value={value} />;
  return (
    <Row
      to={songPath(track.songKey)}
      rank={rank}
      art={{ src: track.albumArtUrl }}
      song={{ uri, name: track.name }}
      title={track.name}
      subtitle={track.artist}
      value={value}
    />
  );
}

function Starters() {
  return (
    <Empty title="No session running">
      Play one of your{" "}
      <AppLink to="/sets" className="font-medium text-primary underline underline-offset-2">
        sets
      </AppLink>
      , or start from{" "}
      <AppLink to="/forgotten" className="font-medium text-primary underline underline-offset-2">
        Forgotten
      </AppLink>
      , the top songs on{" "}
      <AppLink to="/" className="font-medium text-primary underline underline-offset-2">
        Overview
      </AppLink>
      , a month in{" "}
      <AppLink to="/eras" className="font-medium text-primary underline underline-offset-2">
        Eras
      </AppLink>
      , a trip, or your keepers in{" "}
      <AppLink to="/skips" className="font-medium text-primary underline underline-offset-2">
        Skips
      </AppLink>
      .
    </Empty>
  );
}

function Active({ session }: { session: DjSession }) {
  const timezone = useTimezone();
  const uris = [...session.played.map((p) => p.uri), ...(session.current ? [session.current] : []), ...session.upcoming];
  const tracks = useTracks(uris);
  const byUri = new Map(tracks.data?.items.map((t) => [t.uri, t]));
  const skipped = session.played.filter((p) => p.outcome === "skipped").length;
  return (
    <>
      <p className="max-w-2xl text-body-lg text-secondary text-pretty">
        Started {fmtAgo(session.startedAt)}. <strong className="font-semibold text-primary tabular">{fmtInt(session.played.length)}</strong> played,{" "}
        <strong className="font-semibold text-primary tabular">{fmtInt(skipped)}</strong> skipped,{" "}
        <strong className="font-semibold text-primary tabular">{fmtInt(session.upcoming.length)}</strong> to go.{" "}
        {session.replannedAt
          ? `Re-planned the rest at ${fmtTime(session.replannedAt, timezone)} after ${session.replanSkips ?? 2} skips in a row${session.replans > 1 ? `, ${session.replans} times so far` : ""}.`
          : "It re-plans the rest after skips in a row."}
        {session.skipStreak > 0 && ` ${session.skipStreak} skipped in a row now.`}
      </p>
      {session.set && (
        <p className="-mt-4 text-body-sm text-secondary md:-mt-8">
          From the set{" "}
          <AppLink to={`/sets/${session.set.id}`} className="font-medium text-primary underline underline-offset-2">
            {session.set.title}
          </AppLink>
          . How each song did shows on the set.
        </p>
      )}
      {session.current && (
        <Section title="Playing">
          <RowList>
            <TrackRow uri={session.current} track={byUri.get(session.current)} />
          </RowList>
        </Section>
      )}
      <Section title="Up next">
        {!tracks.data && tracks.isPending ? (
          <SkeletonRows rows={5} />
        ) : session.upcoming.length === 0 ? (
          <Empty title="Nothing left in this session" />
        ) : (
          <RowList>
            {session.upcoming.map((uri, i) => (
              <TrackRow key={uri} uri={uri} track={byUri.get(uri)} rank={i + 1} />
            ))}
          </RowList>
        )}
      </Section>
      {session.played.length > 0 && (
        <Section title="Played">
          <RowList>
            {[...session.played].reverse().map((p) => (
              <TrackRow key={p.uri} uri={p.uri} track={byUri.get(p.uri)} value={p.outcome === "skipped" ? "Skipped" : "Finished"} />
            ))}
          </RowList>
        </Section>
      )}
    </>
  );
}

export default function Session() {
  const q = useDj();
  const queryClient = useQueryClient();
  const [stopping, setStopping] = useState(false);
  const session = q.data?.session ?? null;
  const active = session?.status === "active";
  const stop = async () => {
    setStopping(true);
    try {
      await request("/api/dj/stop", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["dj"] });
    } catch (error) {
      showToast(playbackProblem(error), "problem");
    } finally {
      setStopping(false);
    }
  };
  return (
    <Page
      title="Session"
      actions={
        active && (
          <button type="button" className="btn btn-secondary" disabled={stopping} onClick={stop}>
            {stopping ? "Stopping" : "Stop session"}
          </button>
        )
      }
    >
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <SkeletonRows rows={6} />
      ) : active ? (
        <Active session={session} />
      ) : (
        <>
          <Starters />
          {session && session.endReason && (
            <p className="text-body-sm text-secondary">
              Last session ended {session.endedAt ? fmtAgo(session.endedAt) : ""}: {END_REASONS[session.endReason].toLowerCase()}.
            </p>
          )}
        </>
      )}
    </Page>
  );
}
