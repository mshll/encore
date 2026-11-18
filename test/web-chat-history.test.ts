import { describe, expect, test } from "bun:test";
import { groupHistory, historyGroup } from "../web/src/chat/history";

const NOW = new Date(2026, 10, 18, 9, 30);
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString();

describe("chat history groups", () => {
  test("local days decide the group: today from midnight, yesterday, the six days before it, then older", () => {
    expect([at(18, 0), at(17, 23), at(16), at(12), at(11), at(1)].map((t) => historyGroup(t, NOW))).toEqual(["Today", "Yesterday", "This week", "This week", "Older", "Older"]);
  });

  test("groups keep the list's order and leave out the empty ones", () => {
    const items = [{ id: 1, updatedAt: at(18) }, { id: 2, updatedAt: at(18, 8) }, { id: 3, updatedAt: at(2) }];

    expect(groupHistory(items, NOW).map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ["Today", [1, 2]],
      ["Older", [3]],
    ]);
  });
});
