export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function withQuery(path: string, query: Query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function parseError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  return new ApiError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? `Request failed with status ${res.status}`);
}

let onUnauthenticated = () => {};
export const setUnauthenticatedHandler = (handler: () => void) => {
  onUnauthenticated = handler;
};

export async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(
    path,
    json === undefined ? rest : { method: "POST", ...rest, body: JSON.stringify(json), headers: { "content-type": "application/json", ...rest.headers } },
  );
  if (!res.ok) {
    const error = await parseError(res);
    if (res.status === 401 && !path.startsWith("/api/auth/")) onUnauthenticated();
    throw error;
  }
  return (await res.json()) as T;
}

export const get = <T>(path: string, query?: Query) => request<T>(withQuery(path, query));
