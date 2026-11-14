const ART_HOST = /(^|\.)(scdn\.co|spotifycdn\.com)$/;
const TIMEOUT_MS = 5_000;
export const MAX_ART_BYTES = 2_000_000;

/** Album art lives on Spotify's image CDN, outside the Web API and its quota. Other hosts are refused. */
export function isArtUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ART_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes || !res.body) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** One album cover's bytes, or null when the URL is not Spotify art, the request fails or times out, or the file is too large. */
export async function fetchArt(url: string, fetchFn: typeof fetch, maxBytes = MAX_ART_BYTES): Promise<Uint8Array | null> {
  if (!isArtUrl(url)) return null;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
    return res.ok ? await readCapped(res, maxBytes) : null;
  } catch (error) {
    console.warn(`Cover art fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
