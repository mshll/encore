export type Snapshot = {
  trackUri: string;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
  shuffle: boolean;
  deviceName: string;
  deviceType: string;
  contextUri: string | null;
};

export type Observation = Omit<Snapshot, "progressMs" | "isPlaying"> & {
  startedAt: number;
  lastSeenAt: number;
  lastProgressMs: number;
  playedMs: number;
  wasPlaying: boolean;
  reasonStart: string | null;
};

export type ReasonEnd = "trackdone" | "fwdbtn" | "endplay";

export type FinishedPlay = Omit<Observation, "lastSeenAt" | "lastProgressMs" | "playedMs" | "wasPlaying"> & {
  endedAt: number;
  msPlayed: number;
  skipped: boolean | null;
  reasonEnd: ReasonEnd | null;
};

export type StepResult = { current: Observation | null; finished: FinishedPlay[] };

export const SKIP_BEFORE_SHARE = 0.9;
const END_MARGIN_MS = 5000;
const SEEK_SLACK_MS = 2000;
const BACKWARD_JUMP_MS = 5000;

function begin(snap: Snapshot, now: number, reasonStart: string | null): Observation {
  const { progressMs, isPlaying, ...rest } = snap;
  return { ...rest, startedAt: now - progressMs, lastSeenAt: now, lastProgressMs: progressMs, playedMs: progressMs, wasPlaying: isPlaying, reasonStart };
}

function close(obs: Observation, endPosition: number | null, endedAt: number, trackChanged: boolean): FinishedPlay {
  const { lastSeenAt: _seen, lastProgressMs, playedMs, wasPlaying: _playing, ...rest } = obs;
  if (endPosition === null) return { ...rest, endedAt, msPlayed: playedMs, skipped: null, reasonEnd: null };
  const position = Math.min(endPosition, obs.durationMs);
  const reachedEnd = position >= obs.durationMs - END_MARGIN_MS;
  return {
    ...rest,
    endedAt,
    msPlayed: playedMs + Math.max(0, position - lastProgressMs),
    skipped: trackChanged ? position < obs.durationMs * SKIP_BEFORE_SHARE : false,
    reasonEnd: reachedEnd ? "trackdone" : trackChanged ? "fwdbtn" : "endplay",
  };
}

function nextReasonStart(play: FinishedPlay): string | null {
  return play.reasonEnd === "trackdone" || play.reasonEnd === "fwdbtn" ? play.reasonEnd : null;
}

export function step(prev: Observation | null, snap: Snapshot | null, now: number, staleMs: number): StepResult {
  if (!prev) return { current: snap ? begin(snap, now, null) : null, finished: [] };
  const elapsed = now - prev.lastSeenAt;
  const stale = elapsed > staleMs;
  const projected = prev.lastProgressMs + (prev.wasPlaying ? elapsed : 0);

  if (!snap) {
    const play = close(prev, stale ? null : projected, prev.lastSeenAt + (stale ? 0 : projected - prev.lastProgressMs), false);
    return { current: null, finished: [play] };
  }

  if (snap.trackUri !== prev.trackUri) {
    const nextStartedAt = now - snap.progressMs;
    const tail = prev.wasPlaying ? Math.min(Math.max(0, nextStartedAt - prev.lastSeenAt), elapsed) : 0;
    const play = stale ? close(prev, null, prev.lastSeenAt, true) : close(prev, prev.lastProgressMs + tail, prev.lastSeenAt + tail, true);
    return { current: begin(snap, now, nextReasonStart(play)), finished: [play] };
  }

  const delta = snap.progressMs - prev.lastProgressMs;
  const wrapped = delta < -BACKWARD_JUMP_MS && projected >= prev.durationMs - END_MARGIN_MS;
  const implausible = stale && (delta < 0 || delta > elapsed + SEEK_SLACK_MS);
  if (wrapped || implausible) {
    const play = implausible ? close(prev, null, prev.lastSeenAt, false) : close(prev, prev.durationMs, prev.lastSeenAt + (prev.durationMs - prev.lastProgressMs), false);
    return { current: begin(snap, now, implausible ? null : "trackdone"), finished: [play] };
  }

  const { progressMs, isPlaying, ...latest } = snap;
  return {
    current: {
      ...prev,
      ...latest,
      lastSeenAt: now,
      lastProgressMs: progressMs,
      playedMs: prev.playedMs + Math.min(Math.max(0, delta), elapsed + SEEK_SLACK_MS),
      wasPlaying: isPlaying,
    },
    finished: [],
  };
}
