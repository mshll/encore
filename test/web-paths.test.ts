import { describe, expect, test } from "bun:test";
import { artistPath, paramValue, songPath } from "../web/src/app/paths";

const routeParam = (path: string) => decodeURI(path.split("/").pop()!);

describe("entity paths", () => {
  test("a name with reserved characters survives the router's decodeURI", () => {
    const name = "AC/DC, Tyler & #1?";

    const back = paramValue(routeParam(artistPath(name)));

    expect(back).toBe(name);
  });

  test("a literal percent sign is decoded once, not twice", () => {
    const key = "100% pure|nobody";

    const back = paramValue(routeParam(songPath(key)));

    expect(back).toBe(key);
  });
});
