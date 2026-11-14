import type { Answer, AnswerBlock, AnswerSpan, AnswerVisual } from "../api/types";
import { BlockVisual, InlineVisual } from "./AnswerVisual";
import { Icon } from "./Icon";
import { CaretRightIcon } from "./icons";

const MARKER = /\[\[(v\d+)\]\]/g;
const PARTIAL_MARKER = /\[(\[(v\d*\]?)?)?$/;
const BLOCK_KINDS = new Set<AnswerVisual["kind"]>(["ranked", "compare"]);

/**
 * The same split the server stores, for text still streaming or written before answers were structured: paragraphs,
 * visual markers (a block breaks its paragraph), the closing "Based on" line. A marker whose visual has not arrived
 * keeps its place as a block when it stands alone; a half-written marker at the end is hidden.
 */
export function answerFromText(text: string, visuals: Record<string, AnswerVisual> = {}): Answer {
  const paragraphs = text
    .replace(PARTIAL_MARKER, "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const basisAt = paragraphs.findLastIndex((p) => /^Based on\b/.test(p));
  const basis = basisAt > 0 ? paragraphs[basisAt]!.replace(/^Based on:?\s*/, "") : null;
  const blocks: AnswerBlock[] = [];
  for (const [n, paragraph] of paragraphs.entries()) {
    if (n === basisAt && basis !== null) continue;
    let spans: AnswerSpan[] = [];
    const flush = () => {
      if (spans.some((s) => "visual" in s || s.text.trim())) blocks.push({ type: "text", spans });
      spans = [];
    };
    const onlyMarker = paragraph.replace(MARKER, "").trim() === "";
    for (const [i, part] of paragraph.split(MARKER).entries()) {
      if (i % 2 === 0) {
        if (part) spans.push({ text: part });
        continue;
      }
      const visual = visuals[part];
      if (onlyMarker || (visual && BLOCK_KINDS.has(visual.kind))) {
        flush();
        blocks.push({ type: "visual", id: part });
      } else if (visual) spans.push({ visual: part });
    }
    flush();
  }
  return { version: 1, blocks, visuals, basis };
}

function Prose({ spans, visuals }: { spans: AnswerSpan[]; visuals: Record<string, AnswerVisual> }) {
  return (
    <p className="text-body text-pretty">
      {spans.map((s, i) =>
        "visual" in s ? (
          visuals[s.visual] && (
            <span key={i} className="mx-1">
              <InlineVisual visual={visuals[s.visual]!} />
            </span>
          )
        ) : s.unchecked ? (
          <span key={i} className="underline decoration-warning decoration-dotted decoration-2 underline-offset-4">
            {s.text}
            <span className="sr-only"> (not in the data)</span>
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  );
}

const hasUnchecked = (answer: Answer) => answer.blocks.some((b) => b.type === "text" && b.spans.some((s) => "unchecked" in s && s.unchecked));

/** Claude's answer: prose with inline visuals, block visuals between paragraphs, and "Based on" folded away. */
export function AnswerView({ answer }: { answer: Answer }) {
  return (
    <div className="flex flex-col gap-3">
      {answer.blocks.map((b, i) =>
        b.type === "text" ? (
          <Prose key={i} spans={b.spans} visuals={answer.visuals} />
        ) : (
          <div key={i} className="my-2">
            <BlockVisual visual={answer.visuals[b.id]} />
          </div>
        ),
      )}
      {hasUnchecked(answer) && <p className="text-caption text-secondary">Numbers with a dotted line are not in the data Claude read.</p>}
      {answer.basis && (
        <details className="group text-caption text-secondary">
          <summary className="-my-2 flex w-fit cursor-pointer list-none items-center gap-1 rounded-xs py-2 hover:text-primary phone:-my-3 phone:py-3 [&::-webkit-details-marker]:hidden">
            Based on
            <Icon icon={CaretRightIcon} className="transition-transform duration-150 group-open:rotate-90" />
          </summary>
          <p className="mt-1 max-w-[60ch] text-pretty">{answer.basis}</p>
        </details>
      )}
    </div>
  );
}
