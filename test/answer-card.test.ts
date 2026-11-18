import { describe, expect, test } from "bun:test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Answer } from "../src/answers/answer";
import { answerCardInput, clampLines, makeAnswerCard, type AnswerCardInput } from "../src/answers/card";
import { saveAnswer } from "../src/answers/store";
import type { Visual } from "../src/answers/visuals";
import { createSession } from "../src/auth/sessions";
import { createThread } from "../src/llm/threads";
import { testApp } from "./helpers";

const ART = ["https://i.scdn.co/image/a", "https://i.scdn.co/image/b", "https://i.scdn.co/image/c"];

const RANKED: Visual = {
  kind: "ranked",
  title: "Most played songs in January",
  unit: { type: "count", noun: "plays" },
  rows: [
    { item: { kind: "song", name: "Woods", artist: "Mac Miller", songKey: "woods|mac miller", uri: "spotify:track:0000000000000000000001", art: ART[0]! }, value: 20 },
    { item: { kind: "artist", name: "Kanye West", art: ART[1]! }, value: 12 },
    { item: { kind: "album", name: "Circles", artist: "Mac Miller", art: ART[2]! }, value: 9 },
    { item: { kind: "label", name: "Evening" }, value: 4 },
  ],
};
const SERIES: Visual = { kind: "series", title: "Hours by month", unit: { type: "hours" }, axis: "month", points: ["01", "02", "03", "04"].map((m, i) => ({ x: `2026-${m}`, y: [3, 9.5, 0, 6][i]! })) };
const COMPARE: Visual = { kind: "compare", title: "Hours by artist", unit: { type: "hours" }, nowLabel: "March", beforeLabel: "February", rows: [{ label: "Mac Miller", now: 6, before: 2 }, { label: "Joji", now: 1, before: 4 }] };
const SHARE: Visual = { kind: "share", label: "Share of plays on shuffle", share: 0.42, before: 0.3 };

const answer = (first: string, visuals: Record<string, Visual> = {}, block = true): Answer => ({
  version: 1,
  blocks: [
    { type: "text", spans: [{ text: first }, ...(!block && visuals.v1 ? [{ visual: "v1" }] : [])] },
    ...(block && visuals.v1 ? [{ type: "visual" as const, id: "v1" }] : []),
  ],
  visuals,
  basis: "your plays in January 2026.",
});

async function swatch(rgb: string) {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = rgb;
  ctx.fillRect(0, 0, 64, 64);
  return new Uint8Array(await canvas.encode("png"));
}

const artFetch = async () => {
  const bytes = await Promise.all(["#c02020", "#2040c0", "#20a040"].map(swatch));
  return (async (url: string | URL | Request) => new Response(bytes[ART.indexOf(String(url))] ?? bytes[0]!)) as typeof fetch;
};
const offline = ((_url: string | URL | Request) => Promise.reject(new Error("no network"))) as typeof fetch;

async function size(png: Uint8Array) {
  const image = await loadImage(Buffer.from(png));
  return [image.width, image.height];
}

describe("what an answer card shows", () => {
  test("the question, the answer's first sentence and its block visual, without song keys", () => {
    const input = answerCardInput("What did I play most?", answer("Woods led January with 20 plays. Kanye came second.", { v1: RANKED }));

    expect([input.question, input.lead, input.visual?.kind]).toEqual(["What did I play most?", "Woods led January with 20 plays.", "ranked"]);
    expect(input.art).toEqual(ART);
    expect(JSON.stringify(input)).not.toContain("songKey");
  });

  test("an answer with no visual has none on its card, and no art", () => {
    const input = answerCardInput("Who?", answer("Mac Miller, by far."));

    expect([input.lead, input.visual, input.art]).toEqual(["Mac Miller, by far.", null, []]);
  });

  test("an inline series leads the card when there is no block visual", () => {
    const input = answerCardInput("When?", answer("Most in February ", { v1: SERIES }, false));

    expect(input.visual?.kind).toBe("series");
  });
});

describe("drawing an answer card", () => {
  test("a card with a ranked list draws in both formats from the visual's art", async () => {
    const input = answerCardInput("What did I play most in January?", answer("Woods led January with 20 plays.", { v1: RANKED }));
    const fetchFn = await artFetch();

    const [wide, square] = await Promise.all([makeAnswerCard({ ...input, format: "wide", fetchFn }), makeAnswerCard({ ...input, format: "square", fetchFn })]);

    expect([await size(wide), await size(square)]).toEqual([
      [1200, 630],
      [1080, 1080],
    ]);
  });

  test("a card without a visual, with a series, a comparison, a pair or a share draws offline", async () => {
    const inputs: AnswerCardInput[] = [
      answerCardInput("Who?", answer("Mac Miller, by far.")),
      answerCardInput("When?", answer("February was the peak.", { v1: SERIES })),
      answerCardInput("Who changed?", answer("Mac Miller tripled.", { v1: COMPARE })),
      answerCardInput("More?", answer("Yes, twice as many ", { v1: { kind: "pair", label: "Plays in March against February", unit: { type: "count", noun: "plays" }, now: 20, before: 10 } }, false)),
      answerCardInput("Shuffle?", answer("About two in five plays ", { v1: SHARE }, false)),
    ];

    const cards = await Promise.all(inputs.flatMap((i) => (["wide", "square"] as const).map((format) => makeAnswerCard({ ...i, format, fetchFn: offline }))));

    expect(new Set(cards.map((c) => Buffer.from(c).toString("base64"))).size).toBe(cards.length);
  });

  test("a long question is cut to two lines that end in an ellipsis", () => {
    const measure = (text: string, px: number) => text.length * px * 0.5;
    const question = "Which songs did I play most often on weekday evenings in the spring of 2026, and which of them did I keep coming back to afterwards ".repeat(4);

    const lines = clampLines(question, measure, 20, 400, 2);

    expect(lines).toHaveLength(2);
    expect(lines.every((l) => measure(l, 20) <= 400)).toBe(true);
    expect(lines[1]!.endsWith("…")).toBe(true);
  });

  test("a very long question still draws a card", async () => {
    const card = await makeAnswerCard({ ...answerCardInput("why ".repeat(300), answer("Because.")), format: "wide", fetchFn: offline });

    expect(await size(card)).toEqual([1200, 630]);
  });

  test("an Arabic lead is drawn right to left, from the right edge of the text column", async () => {
    const brightOnRight = async (lead: string) => {
      const png = await makeAnswerCard({ question: "", lead, visual: null, art: [], format: "wide", fetchFn: offline });
      const image = await loadImage(Buffer.from(png));
      const canvas = createCanvas(1200, 630);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const px = ctx.getImageData(480, 180, 150, 60).data;
      let bright = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i]! > 200) bright++;
      return bright;
    };

    expect(await brightOnRight("نعم")).toBeGreaterThan(0);
    expect(await brightOnRight("Yes")).toBe(0);
  });
});

describe("the answer card route", () => {
  function setup() {
    const t = testApp({ PUBLIC_BASE_URL: "https://encore.example" });
    const cookie = `__Host-encore_session=${createSession(t.db)}`;
    const threadId = createThread(
      t.db,
      "ask",
      ["s"],
      [
        { role: "user", content: "<owner_message>\nWhen did I listen most?\n</owner_message>\nOwner's local time: x." },
        { role: "assistant", content: [{ type: "text", text: "February was the peak.\n[[v1]]" }] },
      ],
      0,
    );
    saveAnswer(t.db, threadId, 1, answer("February was the peak.", { v1: SERIES }), 0);
    const get = (path: string) => t.app.request(path, { headers: { cookie } });
    return { threadId, get };
  }

  test("the owner downloads an answer's card in both formats", async () => {
    const { threadId, get } = setup();

    const [wide, square] = await Promise.all([get(`/api/ask/threads/${threadId}/turns/1/card`), get(`/api/ask/threads/${threadId}/turns/1/card?format=square`)]);

    expect([wide.status, wide.headers.get("content-type"), wide.headers.get("content-disposition"), square.headers.get("content-disposition")]).toEqual([
      200,
      "image/png",
      'attachment; filename="encore-answer.png"',
      'attachment; filename="encore-answer-square.png"',
    ]);
    expect(await size(new Uint8Array(await square.arrayBuffer()))).toEqual([1080, 1080]);
  });

  test("a question turn, a turn past the end or an unknown thread has no card", async () => {
    const { threadId, get } = setup();

    const res = await Promise.all([`/api/ask/threads/${threadId}/turns/0/card`, `/api/ask/threads/${threadId}/turns/5/card`, `/api/ask/threads/999/turns/1/card`].map(get));

    expect(res.map((r) => r.status)).toEqual([404, 404, 404]);
  });
});
