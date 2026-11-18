import { BACKUP_PREFIX } from "./snapshot";

/** Scheduled backups past the newest `keep`. Names sort by time. Other snapshots are never pruned. */
export function beyondKeep(names: string[], keep: number): string[] {
  return names
    .filter((name) => name.startsWith(BACKUP_PREFIX))
    .sort()
    .reverse()
    .slice(keep);
}
