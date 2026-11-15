const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const parse = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const isLoopback = (url: URL) => url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);

/** Why a redirect URI cannot be registered, or null when it can: https, or http on a loopback host, and no fragment. */
export function redirectUriProblem(value: string): string | null {
  const url = parse(value);
  if (!url) return "not an absolute URL";
  if (url.hash || value.includes("#")) return "must not have a fragment";
  if (url.protocol === "https:" || isLoopback(url)) return null;
  return url.protocol === "http:" ? "http is allowed only for localhost, 127.0.0.1 and [::1]" : "must use https";
}

/**
 * Exact match against the registered URIs, except that a loopback URI matches on any port (RFC 8252 section 7.3):
 * native clients such as Claude Code listen on an ephemeral port.
 */
export function matchesRedirectUri(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const url = parse(requested);
  if (!url || !isLoopback(url)) return false;
  return registered.some((candidate) => {
    const known = parse(candidate);
    if (!known || !isLoopback(known)) return false;
    known.port = url.port;
    return known.href === url.href;
  });
}

export const isLoopbackUri = (value: string) => {
  const url = parse(value);
  return url !== null && isLoopback(url);
};

/** Lowercase scheme and host, no default port, no fragment, no trailing slash: the form MCP clients send as `resource`. */
export function canonicalResource(value: string): string | null {
  const url = parse(value);
  if (!url) return null;
  url.hash = "";
  return url.href.replace(/\/$/, "");
}
