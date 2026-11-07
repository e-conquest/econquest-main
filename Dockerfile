# ==============================================================================
# EconQuest — production image
#
# One image for the Mac (Docker Desktop) and a Linux home server or NAS.
#   - Config only through environment variables (see .env.example); nothing is baked in.
#   - All state under one folder, DATA_DIR=/app/data: mount a single volume there.
#   - Ollama is reached by URL (OLLAMA_BASE_URL), never assumed to run in this container.
#   - Runs as the unprivileged "node" user (uid 1000), not root.
# ==============================================================================

# Stage 1: install everything and build the web pages into /app/dist
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Stage 2: runtime dependencies only (no Vite build tools, Playwright or TypeScript checker)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Stage 3: the image that runs
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    SELF_HOSTED_DOCKER=true \
    PORT=3000 \
    DATA_DIR=/app/data \
    LOG_FORMAT=json

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node server.ts tsconfig.json README.md ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node docs ./docs
COPY --chown=node:node datasets ./datasets

# The one state folder. A volume mounted here keeps settings, saved data and logs across
# upgrades; the image itself holds no state.
RUN mkdir -p /app/data/local && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

# Liveness only: /healthz touches no feeds, files or model.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1

# Node runs as process 1 and handles the stop signal itself, so `docker stop` is clean.
CMD ["node", "--import", "tsx", "server.ts"]
