# encore

Self-hosted, single-user Spotify dashboard. Read [README.md](README.md) for setup and layout, [docs/api.md](docs/api.md) for the HTTP contract.

## Commands

- `bun run dev`: API, jobs and the built UI on 8888. For UI work: `PORT=8889 bun run dev` plus `cd web && bun run dev`.
- Checks before every commit: `bun test`, `bun run typecheck`, `cd web && bun run typecheck && bun run build`.
- Schema change: edit `src/db/schema.ts` (or `assistantSchema.ts`), then `bun run db:generate`. Never edit a migration that has shipped.

## Product rules

- A skip is not a dislike. Use skips as context, never as a negative signal on their own.
- Cleanup never removes saved songs or playlist items by itself. It lists proposals; only an explicit approval through the HTTP route applies them, and every batch can be undone.
- Never start playback without a user action.
- Never store or log `ip_addr` from the export.
- Every Claude call goes through `src/llm` so the ledger records it and the monthly cap applies.
- Never log tokens, keys or cookies.
- Never reset, recreate or rename the data volume, and never deploy with fresh volumes. The database holds track and artist details that cost days of Spotify quota to fetch again. Schema changes go through additive migrations.

## Spotify

- Every Web API call goes through `src/spotify/client.ts`: one paced queue, request calls before job calls, and a gate per endpoint.
- Development-mode apps: batch endpoints are closed, search returns at most 10 items, and some endpoints have a daily quota counted per Spotify account. `GET /tracks/{id}` and `GET /artists/{id}` run out first. Do not call single-item lookups in loops; prefer data that list endpoints already return.
- Album art comes from the public oEmbed endpoint, which is outside the Web API quota.

## Code

- Backend: Bun, Hono, bun:sqlite with Drizzle. Analytics are pure functions in `src/analytics`. Routes stay thin.
- Long Claude runs (picks, sets, ask) are owned by the server (`src/http/runs.ts`). The client follows them with `web/src/lib/useRun.ts`; leaving a page stops listening, not the run. Only Cancel stops it.
- UI: `web/` (Vite, React 19, Tailwind, Base UI, Hugeicons, TanStack Query). Types for API responses live in `web/src/api/types.ts`; keep them in step with `docs/api.md`.
- The Content Security Policy allows no inline scripts and no third-party script origins.
- Update `docs/api.md` in the same commit as any API change.
