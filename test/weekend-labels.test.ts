import { describe, expect, test } from "bun:test";
import { contextLabel, weekendLabels } from "../web/src/lib/format";

describe("weekend labels", () => {
  test("Friday and Saturday weekend reads Sun to Thu for the rest", () => {
    expect(weekendLabels([5, 6])).toEqual({ weekend: "Fri and Sat", weekday: "Sun to Thu" });
  });

  test("Saturday and Sunday weekend reads Mon to Fri", () => {
    expect(weekendLabels([7, 6])).toEqual({ weekend: "Sat and Sun", weekday: "Mon to Fri" });
  });

  test("a split week lists the days", () => {
    expect(weekendLabels([1, 3, 5, 7])).toEqual({ weekend: "Mon, Wed, Fri and Sun", weekday: "Tue, Thu and Sat" });
  });

  test("no weekend and every day", () => {
    expect(weekendLabels([])).toEqual({ weekend: "No weekend", weekday: "Every day" });
    expect(weekendLabels([1, 2, 3, 4, 5, 6, 7]).weekend).toBe("Every day");
  });

  test("context labels use the configured weekend, and stay generic without it", () => {
    expect(contextLabel("dayType", "weekend", [6, 7])).toBe("Sat and Sun");
    expect(contextLabel("dayType", "weekday", [6, 7])).toBe("Mon to Fri");
    expect(contextLabel("dayType", "weekend")).toBe("Weekend");
    expect(contextLabel("hourBucket", "night", [5, 6])).toBe("Night, 00–06");
  });
});
