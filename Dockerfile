FROM oven/bun:1.4.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4 AS web
WORKDIR /app
COPY . .
RUN if [ -f web/package.json ]; then cd web && bun install --frozen-lockfile && bun run build; else mkdir -p web/dist; fi

FROM oven/bun:1.4.4
WORKDIR /app
ENV HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/data/encore.db WEB_DIST=/app/web/dist
COPY --from=deps /app/node_modules node_modules
COPY package.json tsconfig.json ./
COPY src src
COPY drizzle drizzle
COPY assets assets
COPY --from=web /app/web/dist web/dist
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD ["bun", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "src/main.ts"]
