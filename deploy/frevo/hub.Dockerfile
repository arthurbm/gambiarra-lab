# Gambi hub for the Bloco de frevo. Private network only: the hub has no auth.
# Build context: the repository root (needs package.json and bun.lock).
FROM oven/bun:1.4.3-slim AS install
WORKDIR /lock
COPY package.json bun.lock ./
# The gambi version comes from the repo's bun.lock, so the cloud hub is the
# same binary `bun run dev:hub` runs on the notebook.
RUN grep -oE '"gambi@[0-9]+\.[0-9]+\.[0-9]+[^"]*"' bun.lock | head -n 1 | tr -d '"' > /gambi-spec \
  && test -s /gambi-spec && cat /gambi-spec
WORKDIR /hub
# The `gambi` package is a Node wrapper with a postinstall; Bun does not run a
# dependency's postinstall and the image has no Node. The real binary ships in
# the platform's optional package, so it is called directly.
RUN echo '{"name":"frevo-hub","private":true}' > package.json \
  && bun add --exact "$(cat /gambi-spec)" \
  && ARCH="$(uname -m | sed -e 's/x86_64/x64/' -e 's/aarch64/arm64/')" \
  && install -m 0755 "node_modules/gambi-linux-${ARCH}/bin/gambi" /usr/local/bin/gambi \
  && gambi --version

FROM oven/bun:1.4.3-slim
COPY --from=install /usr/local/bin/gambi /usr/local/bin/gambi
# The hub ignores PORT: the port goes by flag. HUB_PORT is only what CMD uses.
ENV HUB_PORT=3000
EXPOSE 3000
USER bun
# `--host ::` listens on IPv6 and IPv4, which Railway's private network needs.
# Shell form to expand HUB_PORT; `exec` lets SIGTERM reach the hub.
CMD ["sh", "-c", "exec gambi hub serve --host :: --port \"${HUB_PORT}\" --format ndjson --no-interactive"]
