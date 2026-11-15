import { describe, expect, test } from "bun:test";
import { contextLabel, resolveContext, routeContext } from "../web/src/app/pageContext";

const routed = (path: string, search = "") => routeContext(decodeURI(path), search);

describe("page context from the address", () => {
  test("an artist page with reserved characters in the name is that artist", () => {
    const context = routed(`/music/artist/${encodeURIComponent("AC/DC & #1?")}`);

    expect(context).toEqual({ kind: "artist", artist: "AC/DC & #1?" });
  });

  test("an album page names the album and its artist", () => {
    const context = routed("/music/album/Mac%20Miller/Circles");

    expect(context).toEqual({ kind: "album", artist: "Mac Miller", album: "Circles" });
  });

  test("a Patterns view keeps a valid range and drops a malformed one", () => {
    const context = routed("/patterns/skips", "from=2026-01-01&to=March");

    expect(context).toEqual({ kind: "patterns", view: "skips", from: "2026-01-01" });
  });

  test("a recap page maps its slug to the period kind", () => {
    const context = routed("/recaps/month/2026-10");

    expect(context).toEqual({ kind: "recap", period: "monthly", key: "2026-10" });
  });

  test("every Library page is the library, and a plan page carries its id", () => {
    const pages = ["/library", "/library/songs", "/library/plans/7"].map((p) => routed(p));

    expect(pages).toEqual([{ kind: "library" }, { kind: "library" }, { kind: "library", planId: 7 }]);
  });

  test("pages without one subject have no context", () => {
    const pages = ["/", "/plays", "/music/artists", "/for-you", "/for-you/unknown", "/sets", "/ask/3", "/settings/claude", "/recaps/day/1"].map((p) => routed(p));

    expect(pages.every((p) => p === null)).toBe(true);
  });
});

describe("page context names", () => {
  test("a song waits for its name before it is sent", () => {
    const route = routed("/music/song/woods%7Cmac%20miller");

    const before = resolveContext(route, null);
    const after = resolveContext(route, JSON.stringify(["Woods", "Mac Miller"]));

    expect([before, after]).toEqual([null, { kind: "song", songKey: "woods|mac miller", name: "Woods", artist: "Mac Miller" }]);
  });

  test("the chip names a Patterns view and its range", () => {
    const labels = [contextLabel({ kind: "patterns", view: "when" }), contextLabel({ kind: "library" })];

    expect(labels).toEqual(["When, all time", "Library"]);
  });
});
