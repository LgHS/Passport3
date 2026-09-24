# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
# better-sqlite3 compiles a native addon at install time (no prebuilt binary for this musl/alpine
# target) — needed in both the `deps` and `prod-deps` stages below, which both run `pnpm install`.
RUN apk add --no-cache python3 make g++

# ---- dependencies (full, incl. dev, for building) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# ---- production-only dependencies ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8030
ENV HOST=0.0.0.0

RUN addgroup -S passport && adduser -S passport -G passport

# The runtime only ever runs `node build/index.js` — the npm/corepack bundled with the base image
# are dead weight here, and they carry their own vulnerable dependencies (flagged by the Trivy scan
# in pr-check.yml), so drop them from the final image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
	/usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./package.json

# /app/data (see src/lib/server/db.ts's DB_PATH) is where the SQLite file lives — a fresh named
# volume mounted here is root-owned by default, which would leave `passport` unable to create the
# database file at all. Created and chowned before switching users, so the mountpoint underneath
# it is already writable regardless of what Docker sets on the volume itself.
RUN mkdir -p /app/data && chown -R passport:passport /app/data

USER passport
EXPOSE 8030
CMD ["node", "build/index.js"]
