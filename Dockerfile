# ---- builder ----
FROM node:20-alpine AS builder

# better-sqlite3 needs to be compiled from source
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install all workspace deps (incl. dev) using package.json files only,
# so dependency layer caches independently of source changes.
COPY package.json tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN npm install --include=dev

# Copy sources and build both workspaces
COPY apps/server ./apps/server
COPY apps/web ./apps/web
RUN npm run build

# ---- runtime ----
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV HOST=0.0.0.0
ENV PORT=3000

# Install only the server's prod deps. better-sqlite3 needs build tools
# during install; remove them in the same layer to keep the image small.
COPY package.json ./
COPY apps/server/package.json ./apps/server/
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm install --omit=dev --workspace=@darts/server \
 && apk del .build-deps

# Copy build artifacts from the builder stage
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "apps/server/dist/index.js"]
