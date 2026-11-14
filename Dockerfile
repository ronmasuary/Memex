# syntax=docker/dockerfile:1

# ---- Build stage: compile TypeScript to dist/ ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
# Install all deps (incl. dev, e.g. typescript) against the lockfile.
COPY package.json package-lock.json ./
RUN npm ci
# Compile the server + CLI (tsconfig.build.json -> dist/). The web UI is not
# needed to run or introspect the MCP server, so it is intentionally skipped.
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: production deps + a seed vault, run the stdio MCP server ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
# simple-git shells out to git at runtime, and `memex init` below needs it too.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Production dependencies only (zero native deps).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Bake a ready vault so Glama can start the server and list its tools without
# any host-provided state. With no git config present the committer falls back
# to the built-in Memex identity (see FALLBACK_IDENTITY in src/git.ts).
ENV MEMEX_VAULT=/vault
RUN node dist/cli.js init "$MEMEX_VAULT"
# stdio MCP server: stdout is the protocol channel, so all logs go to stderr.
CMD ["node", "dist/mcp.js"]
