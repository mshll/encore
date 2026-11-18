// One real play can reach the table twice: from the watcher (source 'live') and from recently-played (source 'api').
// They are the same play when the api timestamp falls inside the live play's window below. The live row wins.
export const MATCH_BEFORE_MS = 15_000;
export const MATCH_AFTER_MS = 60_000;
