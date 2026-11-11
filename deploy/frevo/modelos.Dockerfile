# Model host of the Bloco de frevo: the model participants in the Room. The
# only service with the provider key. Private network only.
# Build context: the repository root.
FROM oven/bun:1.4.3-slim
WORKDIR /repo
# The whole repo goes in because `bun install --frozen-lockfile` needs every
# workspace's package.json. .dockerignore drops node_modules, .git, docs,
# builds and any *.key / *.secret. Bun blocks the `gambi` postinstall; expected.
COPY . .
RUN bun install --frozen-lockfile
COPY deploy/frevo/secrets-entrypoint.sh /usr/local/bin/secrets-entrypoint
ENV NODE_ENV=production
# GET /health answers here. On Railway PORT must repeat it: the healthcheck
# knocks on PORT. The host listens on `::` (IPv6 and IPv4).
ENV FREVO_MODEL_HOST_PORT=3002
ENV PORT=3002
EXPOSE 3002
USER bun
ENTRYPOINT ["secrets-entrypoint"]
CMD ["bun", "run", "apps/frevo/src/model-host/index.ts"]
