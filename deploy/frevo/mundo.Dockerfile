# World server and web of the Bloco de frevo. The only public service.
# Build context: the repository root.
FROM oven/bun:1.4.3-slim
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
# The world serves apps/frevo-web/dist itself (src/server/index.ts finds it).
RUN bun run --cwd apps/frevo-web build
COPY deploy/frevo/secrets-entrypoint.sh /usr/local/bin/secrets-entrypoint
ENV NODE_ENV=production
# The server reads PORT (Railway sets the healthcheck on it) and listens on
# `::` unless HOST says otherwise.
ENV PORT=3001
EXPOSE 3001
USER bun
ENTRYPOINT ["secrets-entrypoint"]
CMD ["bun", "run", "apps/frevo/src/server/index.ts"]
