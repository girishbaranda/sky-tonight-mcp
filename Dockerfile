# Multi-stage build. Stage 1 compiles TypeScript and the better-sqlite3 native
# binding. Stage 2 ships only what runtime needs.

FROM node:22-slim AS build

# Build deps for better-sqlite3's native compile (Python, make, g++).
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all deps (including dev) for build.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

RUN npm run build

# Prune to runtime deps only.
RUN npm prune --omit=dev

# ----- Stage 2: runtime -----
FROM node:22-slim

WORKDIR /app

# Non-root user
RUN groupadd --system app && useradd --system --gid app --create-home app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/migrations ./migrations
COPY --chown=app:app package.json ./

USER app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

CMD ["node", "dist/http.js"]
