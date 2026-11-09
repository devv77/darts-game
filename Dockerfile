# Version hash baked into both the web bundle (Vite define) and the server env.
ARG GIT_SHA=dev

# ---- builder ----
# glibc (Debian slim), not Alpine: package-lock.json is generated on glibc (Renovate)
# and npm drops the musl builds of optional native packages from it, so `npm ci`
# on Alpine misses e.g. @rollup/rollup-linux-x64-musl (build 4077, 2026-11-09).
# Same base family as stork-exchange/cukornaplo. Pinned tag + digest; Renovate
# keeps the digest current.
FROM node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS builder
ARG GIT_SHA

# better-sqlite3 compiles from source when no prebuilt binary matches
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all workspace deps (incl. dev) exactly as locked, so the image is built
# from the same dependency tree that was tested (npm install without the lockfile
# re-resolved and broke on vite 8's peer ranges, 2026-11-09). Manifests + lockfile
# only, so the dependency layer still caches independently of source changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN npm ci --include=dev

# Copy sources and build both workspaces (GIT_SHA → Vite define for the web bundle)
COPY apps/server ./apps/server
COPY apps/web ./apps/web
ENV GIT_SHA=${GIT_SHA}
RUN npm run build

# ---- runtime ----
FROM node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
ARG GIT_SHA

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV HOST=0.0.0.0
ENV PORT=3000
ENV GIT_SHA=${GIT_SHA}

# Install only the server's prod deps. better-sqlite3 needs build tools
# during install; remove them in the same layer to keep the image small.
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev --workspace=@darts/server \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Copy build artifacts from the builder stage
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "apps/server/dist/index.js"]
