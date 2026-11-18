import { parseError, toApiError } from "./client";
import type { AnswerVisual, ChatTask } from "./types";

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; input: Record<string, unknown> }
  | { type: "visual"; id: string; visual: AnswerVisual }
  | { type: "task"; task: ChatTask };

export type StreamHandlers = { onEvent: (event: StreamEvent) => void; onRun?: (run: { id: string; startedAt: string }) => void };

/** POSTs to an assistant endpoint as Server-Sent Events and resolves with the `done` body. Aborting only stops listening: the run continues on the server. */
export async function streamPost<T>(path: string, body: unknown, handlers: StreamHandlers, signal?: AbortSignal): Promise<T> {
  return readStream<T>(await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body), signal }), handlers);
}

/** Follows a run that is already working: replays its events so far, then resolves with its `done` body. */
export async function followRun<T>(id: string, handlers: StreamHandlers, signal?: AbortSignal): Promise<T> {
  return readStream<T>(await fetch(`/api/runs/${id}/events`, { headers: { accept: "text/event-stream" }, signal }), handlers);
}

async function readStream<T>(res: Response, { onEvent, onRun }: StreamHandlers): Promise<T> {
  if (!res.ok || !res.body) throw await parseError(res);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end = buffer.indexOf("\n\n");
    while (end >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf("\n\n");
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!event || !data) continue;
      const parsed = JSON.parse(data);
      if (event === "run") onRun?.(parsed);
      if (event === "done") return parsed as T;
      if (event === "error") throw toApiError(500, parsed);
      if (event === "text") onEvent({ type: "text", delta: parsed.delta });
      if (event === "tool") onEvent({ type: "tool", name: parsed.name, input: parsed.input ?? {} });
      if (event === "visual") onEvent({ type: "visual", id: parsed.id, visual: parsed.visual });
      if (event === "task") onEvent({ type: "task", task: parsed.task });
    }
  }
  throw toApiError(502, { error: { code: "llm_incomplete", message: "The stream ended early" } });
}
