import { parseError, toApiError } from "./client";

export type StreamEvent = { type: "text"; delta: string } | { type: "tool"; name: string; input: Record<string, unknown> };

/** POSTs to an assistant endpoint as Server-Sent Events and resolves with the `done` body. */
export async function streamPost<T>(path: string, body: unknown, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
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
      if (event === "done") return parsed as T;
      if (event === "error") throw toApiError(500, parsed);
      if (event === "text") onEvent({ type: "text", delta: parsed.delta });
      if (event === "tool") onEvent({ type: "tool", name: parsed.name, input: parsed.input ?? {} });
    }
  }
  throw toApiError(502, { error: { code: "llm_incomplete", message: "The stream ended early" } });
}
