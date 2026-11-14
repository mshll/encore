import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { request } from "../../api/client";
import { useLiving, useStatus } from "../../api/queries";
import type { RecapPeriod, RecapSong, SavedPlaylist } from "../../api/types";
import { assistantProblem } from "../../lib/assistant";
import { showToast } from "../../lib/toast";
import { usePlayback } from "../../player/playback";
import { AppLink } from "../../ui/AppLink";
import { Artwork } from "../../ui/Artwork";
import { Button, buttonClass } from "../../ui/Button";
import { PlayIcon } from "../../ui/icons";

function savedMessage(updated: boolean, cover: SavedPlaylist["cover"]["status"]): string {
  const base = updated ? "Playlist updated in Spotify" : "Saved to Spotify as a private playlist";
  if (cover === "failed") return `${base}, without its cover.`;
  if (cover === "missing_scope") return `${base}. Connect Spotify again in Settings to add its cover.`;
  return `${base}.`;
}

/** The year still going lives in Spotify as This year so far, the living playlist, not as a saved copy. */
function YearSoFar() {
  const queryClient = useQueryClient();
  const living = useLiving();
  const [busy, setBusy] = useState(false);
  const item = living.data?.items.find((p) => p.kind === "this-year");
  if (!living.data || !item) return null;
  if (item.enabled && item.playlist)
    return (
      <a className={buttonClass({ size: "sm" })} href={item.playlist.url} target="_blank" rel="noreferrer">
        Open in Spotify
      </a>
    );
  if (!living.data.spotify.canWrite) return null;
  const keep = async () => {
    setBusy(true);
    try {
      await request("/api/living/this-year", { method: "PATCH", json: { enabled: true } });
      await queryClient.invalidateQueries({ queryKey: ["living"] });
      showToast("This year so far is in your Spotify account. encore refills it each week.");
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" busy={busy} busyLabel="Saving" onClick={() => void keep()}>
      Keep in Spotify
    </Button>
  );
}

/** Play the period's songs, and save them to Spotify on the owner's tap (or open the playlist once saved). */
export function RecapPlaylistActions({ period, songs }: { period: RecapPeriod; songs: RecapSong[] }) {
  const queryClient = useQueryClient();
  const status = useStatus();
  const playback = usePlayback();
  const [busy, setBusy] = useState<"play" | "save" | null>(null);
  const playlist = period.playlist;
  if (!status.data || !playlist) return null;
  if (!status.data.spotify.connected)
    return (
      <AppLink to="/settings/spotify" className={buttonClass({ size: "sm", variant: "ghost" })}>
        Connect Spotify
      </AppLink>
    );
  const uris = songs.flatMap((s) => (s.uri ? [s.uri] : []));
  const play = async () => {
    setBusy("play");
    await playback.play(uris);
    setBusy(null);
  };
  const save = async () => {
    setBusy("save");
    try {
      const saved = await request<SavedPlaylist>(`/api/digests/periods/${period.kind}/${period.key}/playlist`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["digests"] });
      showToast(savedMessage(Boolean(playlist.saved), saved.cover.status));
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {playlist.saved && playlist.coverUrl && <Artwork src={playlist.coverUrl} kind="playlist" box={32} />}
      <Button size="sm" icon={PlayIcon} disabled={uris.length === 0 || busy !== null} busy={busy === "play"} busyLabel="Starting" onClick={() => void play()}>
        Play
      </Button>
      {period.inProgress && period.kind === "yearly" ? (
        <YearSoFar />
      ) : playlist.saved ? (
        <a className={buttonClass({ size: "sm" })} href={playlist.saved.url} target="_blank" rel="noreferrer">
          Open in Spotify
        </a>
      ) : (
        playlist.canSave && (
          <Button size="sm" disabled={busy !== null} busy={busy === "save"} busyLabel="Saving" onClick={() => void save()}>
            Save to Spotify
          </Button>
        )
      )}
    </div>
  );
}
