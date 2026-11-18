export const HISTORY_GROUPS = ["Today", "Yesterday", "This week", "Older"] as const;
export type HistoryGroup = (typeof HISTORY_GROUPS)[number];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Which group a conversation last changed at `at` falls in, by the viewer's local days. This week is the six days before yesterday. */
export function historyGroup(at: string, now: Date): HistoryGroup {
  const today = startOfDay(now);
  const day = startOfDay(new Date(at));
  const daysAgo = Math.round((today - day) / 86_400_000);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return "This week";
  return "Older";
}

/** Items newest first, split into the groups that hold any, in order. */
export function groupHistory<T extends { updatedAt: string }>(items: T[], now: Date): { group: HistoryGroup; items: T[] }[] {
  const by = new Map<HistoryGroup, T[]>();
  for (const item of items) {
    const group = historyGroup(item.updatedAt, now);
    by.set(group, [...(by.get(group) ?? []), item]);
  }
  return HISTORY_GROUPS.flatMap((group) => (by.has(group) ? [{ group, items: by.get(group)! }] : []));
}
