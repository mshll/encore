import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { request } from "../api/client";
import { useSet } from "../api/queries";
import type { ChatOutcome, ChatSetCard, ChatSong, RuleDraft, SavedPlaylist } from "../api/types";
import { assistantProblem, savedMessage } from "../lib/assistant";
import { fmtInt } from "../lib/format";
import { plural } from "../lib/insights";
import { showToast } from "../lib/toast";
import { playbackProblem, usePlayback } from "../player/playback";
import { describeRule } from "../surfaces/playlists/rules";
import { AppLink } from "../ui/AppLink";
import { Artwork } from "../ui/Artwork";
import { Button, buttonClass } from "../ui/Button";
import { PlayIcon, QueueIcon } from "../ui/icons";
import { useChat } from "./state";

/** One outcome in the thread: a faint fill groups the thing made with the actions that use it. */
function Card({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="flex flex-col gap-3 rounded-lg bg-card p-3 animate-[fade-up_450ms_var(--ease-out)_both]">
      {children}
    </section>
  );
}

function Head({ art, title, detail }: { art?: ReactNode; title: string; detail: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {art}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-primary" title={title}>
          {title}
        </span>
        <span className="truncate text-caption text-secondary tabular">{detail}</span>
      </div>
    </div>
  );
}

/** Opens a page from the thread; on a phone the sheet closes so the page shows. */
function OpenLink({ to, children, variant = "ghost" }: { to: string; children: ReactNode; variant?: "ghost" | "secondary" }) {
  const { leave } = useChat();
  return (
    <AppLink to={to} onClick={leave} className={buttonClass({ size: "sm", variant })}>
      {children}
    </AppLink>
  );
}

function Gone({ what }: { what: string }) {
  return <p className="text-secondary">{what}</p>;
}

/** A set the chat made or changed: Play, Open, Save to Spotify. */
export function SetCard({ setId, card }: { setId: number; card: ChatSetCard | null }) {
  const queryClient = useQueryClient();
  const playback = usePlayback();
  const detail = useSet(card ? setId : 0);
  const [saving, setSaving] = useState(false);
  if (!card) return <Gone what="This set was deleted." />;
  if (card.version === 0) return null;
  const set = detail.data;
  const title = set?.title ?? card.title;
  const tracks = set?.items.length ?? card.tracks;
  const saved = set?.playlist && !set.playlist.outdated;
  const play = () => {
    if (!set) return;
    if (set.playlist && !set.playlist.outdated) void playback.playContext(`spotify:playlist:${set.playlist.id}`);
    else void playback.play(set.items.map((i) => i.uri));
  };
  const save = async () => {
    setSaving(true);
    try {
      const result = await request<SavedPlaylist>(`/api/sets/${setId}/playlist`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["sets"] });
      showToast(savedMessage(Boolean(set?.playlist), result.cover.status));
    } catch (error) {
      showToast(assistantProblem(error), "problem");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card label={`Set: ${title}`}>
      <Head art={<Artwork src={set?.coverUrl ?? card.coverUrl} kind="playlist" box={48} />} title={title} detail={`${plural(tracks, "song", "songs")}${saved ? " · in your Spotify" : ""}`} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="accent" icon={PlayIcon} disabled={!set || tracks === 0} onClick={play}>
          Play
        </Button>
        <OpenLink to={`/playlists/set-${setId}`}>Open</OpenLink>
        {!saved && (
          <Button size="sm" variant="ghost" disabled={!set || tracks === 0} busy={saving} busyLabel="Saving" onClick={() => void save()}>
            {set?.playlist ? "Update playlist" : "Save to Spotify"}
          </Button>
        )}
      </div>
    </Card>
  );
}

/** A plan the chat made: how much waits for review, and the plan page, where Apply stays. */
export function PlanCard({ plan }: { plan: Extract<ChatOutcome, { kind: "plan" }>["plan"] }) {
  if (!plan) return <Gone what="This plan was deleted." />;
  const detail = plan.status === "applied" ? "Applied" : plan.status === "dismissed" ? "Dismissed" : `${plural(plan.open, "song", "songs")} to review`;
  return (
    <Card label={`Plan: ${plan.title}`}>
      <Head title={plan.title} detail={detail} />
      <div className="flex flex-wrap items-center gap-2">
        <OpenLink to={`/library/plans/${plan.id}`} variant="secondary">
          Review
        </OpenLink>
      </div>
    </Card>
  );
}

/** A rule playlist drafted in the chat: the rule in plain words and what it would hold. Created only from Build from rules. */
export function RuleCard({ draft }: { draft: RuleDraft | null }) {
  if (!draft) return <Gone what="This draft is gone." />;
  return (
    <Card label={`Playlist rule: ${draft.name}`}>
      <Head title={draft.name} detail={`Would hold ${plural(draft.count, "song", "songs")} now`} />
      <ul className="flex flex-col gap-0.5 text-caption text-secondary">
        {describeRule(draft.rule).map((line) => (
          <li key={line} className="text-pretty">
            {line}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <OpenLink to={`/playlists/new?draft=${draft.id}`} variant="secondary">
          Review and create
        </OpenLink>
      </div>
    </Card>
  );
}

const SHOWN = 6;

/** Songs to play or queue. Nothing plays until one of the buttons is pressed. */
export function PlayCard({ title, songs }: { title: string | null; songs: ChatSong[] }) {
  const playback = usePlayback();
  const [all, setAll] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const queue = async () => {
    setQueueing(true);
    try {
      for (const song of songs) await request("/api/player/queue", { json: { uri: song.uri } });
      showToast(`Added ${plural(songs.length, "song", "songs")} to the queue.`);
    } catch (error) {
      showToast(playbackProblem(error), "problem");
    } finally {
      setQueueing(false);
    }
  };
  const shown = all ? songs : songs.slice(0, SHOWN);
  return (
    <Card label={title ?? "Songs to play"}>
      <Head title={title ?? "Songs to play"} detail={plural(songs.length, "song", "songs")} />
      <ol className="flex flex-col gap-1">
        {shown.map((s) => (
          <li key={s.songKey} className="flex min-w-0 items-center gap-3">
            <Artwork src={s.albumArtUrl} kind="song" box={32} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-primary" title={s.name}>
                {s.name}
              </span>
              <span className="truncate text-caption text-secondary">{s.artist}</span>
            </span>
          </li>
        ))}
      </ol>
      {songs.length > SHOWN && !all && (
        <button type="button" onClick={() => setAll(true)} className="press w-fit rounded-xs text-caption font-medium text-secondary hover:text-primary">
          Show all {fmtInt(songs.length)}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="accent" icon={PlayIcon} onClick={() => void playback.play(songs.map((s) => s.uri))}>
          Play
        </Button>
        <Button size="sm" variant="ghost" icon={QueueIcon} busy={queueing} busyLabel="Adding" onClick={() => void queue()}>
          Add to queue
        </Button>
      </div>
    </Card>
  );
}
