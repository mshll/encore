import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, get, request } from "../../api/client";
import { usePicks, useRadar } from "../../api/queries";
import type { LivingDetail, LivingId, LivingKind, LivingList, LivingOutcome, LivingPlaylist, LivingQuietUpdate, LivingSong, LivingUpdate } from "../../api/types";
import { songPath } from "../../app/paths";
import { fmtAgo, fmtInt } from "../../lib/format";
import { showToast } from "../../lib/toast";
import { usePlayback } from "../../player/playback";
import { AppLink } from "../../ui/AppLink";
import { Artwork } from "../../ui/Artwork";
import { buttonClass, IconButton } from "../../ui/Button";
import { PlayIcon } from "../../ui/icons";
import { cx } from "../../ui/cx";
import { Notice } from "../../ui/Notice";
import { Row } from "../../ui/Rows";
import { Skeleton } from "../../ui/Skeleton";

export const KINDS: LivingKind[] = ["picks", "forgotten", "most-played", "new-releases", "this-month", "this-year", "right-now"];
export const isKind = (value: string): value is LivingKind => (KINDS as string[]).includes(value);
const RULE_ID = /^rule-[0-9a-f]{10}$/;
export const isLivingId = (value: string): value is LivingId => isKind(value) || RULE_ID.test(value);

export const playlistPath = (id: LivingId) => `/playlists/${id}`;
export const setPlaylistPath = (setId: number) => `/playlists/set-${setId}`;
export const songs = (n: number) => `${fmtInt(n)} ${n === 1 ? "song" : "songs"}`;

/** What a built-in holds once it has songs; shown while it has none. */
export const NOTHING_YET: Record<LivingKind, string> = {
  picks: "Picks appear after the next weekly run.",
  forgotten: "Songs you played 10 times or more, then left for 90 days, appear here.",
  "most-played": "Songs you play at least twice in four weeks appear here.",
  "new-releases": "Songs appear here when an artist you play releases something new.",
  "this-month": "Songs you played this month in an earlier year appear here.",
  "this-year": "Songs you play at least twice this year appear here.",
  "right-now": "Songs you play at least twice on this weekday at this time of day appear here.",
};

export type Gate = LivingList["spotify"];

/** Kinds made of songs the owner has played, so each has a song page. */
const PLAYED_KINDS: LivingId[] = ["forgotten", "most-played", "this-month", "this-year", "right-now"];

/** A song in a living playlist: the shared row with play and the song menu. Rule songs open their page when they have plays. */
export function SongRow({ song, rank, kind }: { song: LivingSong; rank?: number; kind: LivingId }) {
  const played = PLAYED_KINDS.includes(kind) || kind.startsWith("rule-");
  return (
    <Row
      to={played ? songPath(song.songKey) : undefined}
      title={song.name}
      subtitle={song.artist}
      art={{ src: song.albumArtUrl, kind: "song" }}
      rank={rank}
      song={{ uri: song.uri, name: song.name, songKey: song.songKey, artist: song.artist }}
    />
  );
}

const spotifySettings = (
  <AppLink to="/settings/spotify" className={buttonClass({ size: "sm" })}>
    Open Spotify settings
  </AppLink>
);

/** Why keeping a playlist in Spotify cannot work right now, if anything. */
export function gateNotice(gate: Gate) {
  if (!gate.connected)
    return (
      <Notice tone="warning" action={spotifySettings}>
        Connect Spotify to keep playlists in your account.
      </Notice>
    );
  if (!gate.canWrite)
    return (
      <Notice tone="warning" action={spotifySettings}>
        encore is not allowed to change playlists yet. Connect Spotify again to allow it.
      </Notice>
    );
  return null;
}

export type Fresh = { text: string; problem: boolean; news: boolean };

/** One line on a living playlist: a problem first, then what is new, then how fresh it is, and whether it is in Spotify. */
export function freshLine(p: LivingPlaylist, news: string | null, withSpotify = false): Fresh {
  if (p.removedAt) return { text: "Deleted in Spotify", problem: true, news: false };
  if (p.enabled && p.status === "failed") return { text: p.playlist ? "The last refresh failed" : "Could not be added to Spotify", problem: true, news: false };
  const kept = withSpotify && p.enabled && p.playlist !== null ? " · in your Spotify" : "";
  if (news) return { text: `${news}${kept}`, problem: false, news: true };
  if (!p.enabled) return { text: p.available ? `${songs(p.available)}, not in Spotify` : "Nothing in it yet", problem: false, news: false };
  if (!p.playlist) return { text: "Not in Spotify yet", problem: false, news: false };
  if (p.status === "deferred") return { text: "Waits until it stops playing", problem: false, news: false };
  const fresh = p.frozen ? `Frozen, ${songs(p.count)}` : p.changedAt ? `Updated ${fmtAgo(p.changedAt)}` : songs(p.count);
  return { text: `${fresh}${kept}`, problem: false, news: false };
}

export const playable = (p: LivingPlaylist) => (p.enabled && p.playlist ? p.count : p.available) > 0;

function requestProblem(error: unknown): string {
  if (error instanceof ApiError && error.code === "spotify_not_connected") return "Connect Spotify first.";
  if (error instanceof ApiError && error.code === "missing_scope") return "Connect Spotify again in Settings to allow playlist changes.";
  return "Could not reach encore. Try again.";
}

/** Plays the playlist in Spotify when it is there, otherwise the songs encore would put in it. */
export function usePlayPlaylist() {
  const playback = usePlayback();
  const queryClient = useQueryClient();
  return async (p: LivingPlaylist) => {
    if (p.enabled && p.playlist) return void (await playback.playContext(`spotify:playlist:${p.playlist.id}`));
    try {
      const detail = await queryClient.fetchQuery({ queryKey: ["living", p.kind], queryFn: () => get<LivingDetail>(`/api/living/${p.kind}`) });
      const uris = (detail.items.length ? detail.items : detail.preview).map((s) => s.uri);
      if (uris.length) await playback.play(uris);
    } catch (error) {
      showToast(requestProblem(error), "problem");
    }
  };
}

function outcomeMessage(o: LivingOutcome, name: string, enabling: boolean): { text: string; problem: boolean } {
  const cover = o.cover === "missing_scope" ? " Connect Spotify again in Settings to add its cover." : o.cover === "failed" ? " Its cover was not added; it is tried again on the next refresh." : "";
  switch (o.status) {
    case "off":
      return { text: `${name} is off. The playlist stays in Spotify as it is.`, problem: false };
    case "refreshed":
      return { text: `${enabling ? `${name} is in your Spotify account.` : `${name} is updated in Spotify.`}${cover}`, problem: false };
    case "unchanged":
      return { text: `${name} is already up to date.${cover}`, problem: false };
    case "empty":
      return { text: enabling ? `${name} is in your Spotify account, empty for now.${cover}` : `Nothing new to put in ${name}.`, problem: false };
    case "deferred":
      return { text: `${name} is playing now. The refresh waits until it stops.`, problem: false };
    case "removed":
      return { text: `${name} was deleted in Spotify. Keep it in Spotify again to make a new one.`, problem: true };
    case "failed":
      return { text: `Spotify did not take the change to ${name}. It is tried again within the hour.`, problem: true };
  }
}

/** Keep in Spotify, Refresh now and Freeze; keeps the list and the playlist's page in step. */
export function useLivingAction(kind: LivingId, name: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"toggle" | "refresh" | "freeze" | null>(null);
  const run = async (what: "toggle" | "refresh" | "freeze", init: { path: string; method: string; json?: unknown }, done: (update: LivingUpdate | LivingQuietUpdate) => void) => {
    setBusy(what);
    try {
      const update = await request<LivingUpdate | LivingQuietUpdate>(init.path, { method: init.method, ...(init.json === undefined ? {} : { json: init.json }) });
      queryClient.setQueryData(["living", kind], update.playlist);
      await queryClient.invalidateQueries({ queryKey: ["living"], exact: true });
      done(update);
    } catch (error) {
      showToast(requestProblem(error), "problem");
    } finally {
      setBusy(null);
    }
  };
  const tell = (enabling: boolean) => (update: LivingUpdate | LivingQuietUpdate) => {
    if (!update.outcome) return;
    const message = outcomeMessage(update.outcome, name, enabling);
    showToast(message.text, message.problem ? "problem" : "info");
  };
  return {
    busy,
    toggle: (enabled: boolean) => run("toggle", { path: `/api/living/${kind}`, method: "PATCH", json: { enabled } }, tell(enabled)),
    refresh: () => run("refresh", { path: `/api/living/${kind}/refresh`, method: "POST" }, tell(false)),
    freeze: (frozen: boolean) =>
      run("freeze", { path: `/api/living/${kind}`, method: "PATCH", json: { frozen } }, () =>
        showToast(frozen ? `${name} keeps its songs until you refresh it.` : `${name} refreshes on its schedule again.`),
      ),
  };
}

/** What is new in a playlist that has its own source of news: this week's unopened picks, unseen releases. */
export function useNews(): Partial<Record<LivingKind, string>> {
  const picks = usePicks();
  const radar = useRadar("new");
  const newPicks = picks.data?.picks.filter((p) => p.state === "new").length ?? 0;
  const releases = radar.data?.unseenNew ?? 0;
  return {
    ...(newPicks > 0 && { picks: `${fmtInt(newPicks)} new ${newPicks === 1 ? "pick" : "picks"} this week` }),
    ...(releases > 0 && { "new-releases": `${fmtInt(releases)} new ${releases === 1 ? "release" : "releases"}` }),
  };
}

export const newsOf = (news: Partial<Record<LivingKind, string>>, kind: LivingId) => (kind in news ? (news[kind as LivingKind] ?? null) : null);

/**
 * A cover on Home's shelf. The generated cover carries the name, so under it is only the fresh line and Play. The cover
 * opens the playlist's page.
 */
function ShelfItem({ playlist, news }: { playlist: LivingPlaylist; news: string | null }) {
  const play = usePlayPlaylist();
  const line = freshLine(playlist, news);
  return (
    <li className="flex w-32 shrink-0 snap-start flex-col gap-2 md:w-36">
      <AppLink to={playlistPath(playlist.kind)} aria-label={`${playlist.name}, ${line.text}`} className="rounded-md">
        <Artwork src={playlist.coverUrl} kind="playlist" box="fill" />
      </AppLink>
      <div className="flex items-start gap-1">
        <span className={cx("line-clamp-2 min-w-0 flex-1 text-caption", line.problem ? "text-danger" : line.news ? "text-primary" : "text-secondary")}>{line.text}</span>
        {playable(playlist) && <IconButton icon={PlayIcon} label={`Play ${playlist.name}`} size="sm" variant="secondary" className="-mt-1 -mr-1 shrink-0 rounded-full" onClick={() => void play(playlist)} />}
      </div>
    </li>
  );
}

/** One row of covers that scrolls sideways when it does not fit, snapping to each cover. */
const SHELF = "-mx-(--gutter) flex snap-x snap-mandatory scroll-px-(--gutter) gap-4 overflow-x-auto overscroll-x-contain px-(--gutter) pb-1 no-scrollbar";

export function PlaylistShelfSkeleton() {
  return (
    <div aria-hidden className={SHELF}>
      {KINDS.map((k) => (
        <div key={k} className="flex w-32 shrink-0 flex-col gap-2 md:w-36">
          <Skeleton className="aspect-square w-full rounded-md" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** The built-ins as covers (Home), in the order given: name, one line on what is new or how fresh, Play. */
export function PlaylistShelf({ items }: { items: LivingPlaylist[] }) {
  const news = useNews();
  return (
    <ul className={SHELF}>
      {items.map((p) => (
        <ShelfItem key={p.kind} playlist={p} news={newsOf(news, p.kind)} />
      ))}
    </ul>
  );
}
