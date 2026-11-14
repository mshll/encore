import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "./context";
import { ApiError } from "./errors";

export const PRE_AUTH_BODY_BYTES = 64 * 1024;
export const API_BODY_BYTES = 1024 * 1024;
export const IMPORT_BODY_BYTES = 512 * 1024 * 1024;

export const limitBody = (maxSize: number): MiddlewareHandler<Env> =>
  bodyLimit({
    maxSize,
    onError: () => {
      throw new ApiError(413, "body_too_large", `Request body exceeds ${Math.round(maxSize / 1024)} KB`);
    },
  });

export class PartTooLargeError extends Error {}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Fails the body stream as soon as one multipart part grows past `maxPartBytes`, so an oversized file is never fully buffered. */
export function limitMultipartParts(request: Request, maxPartBytes: number): Request {
  const boundary = request.headers.get("content-type")?.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!request.body || !boundary) return request;
  const delimiter = new TextEncoder().encode(`--${boundary[1] ?? boundary[2]}`);
  let tail = new Uint8Array(0);
  let partBytes = 0;
  const count = (chunk: Uint8Array): boolean => {
    const window = new Uint8Array(tail.length + chunk.length);
    window.set(tail);
    window.set(chunk, tail.length);
    let from = 0;
    for (let at = indexOf(window, delimiter, 0); at !== -1; at = indexOf(window, delimiter, from)) {
      if (partBytes + at - from > maxPartBytes) return false;
      from = at + delimiter.length;
      partBytes = 0;
    }
    const keep = Math.max(from, window.length - delimiter.length + 1);
    partBytes += keep - from;
    tail = window.slice(keep);
    return partBytes <= maxPartBytes;
  };
  const reader = request.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      if (count(value)) return controller.enqueue(value);
      controller.error(new PartTooLargeError(`A part exceeds ${maxPartBytes} bytes`));
      await reader.cancel();
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}
