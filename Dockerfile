# syntax=docker/dockerfile:1
FROM node:25-alpine AS base
WORKDIR /app
# Node 25+ no longer bundles corepack, so it's installed from npm first. `--force` because the image
# still ships a standalone /usr/local/bin/yarn that npm would otherwise refuse to overwrite (EEXIST).
RUN npm install -g --force corepack && corepack enable

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
FROM node:25-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8030
ENV HOST=0.0.0.0

# The Node base image is only rebuilt every so often, so its Alpine packages (e.g. OpenSSL) can lag
# behind fixes already published in the Alpine repos — pull those in at build time.
RUN apk upgrade --no-cache

RUN addgroup -S passport && adduser -S passport -G passport

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./package.json

# /app/data (see src/lib/server/db.ts's DATA_DIR) is where uploaded avatars live — a fresh named
# volume mounted here is root-owned by default, which would leave `passport` unable to write to it
# at all. Created and chowned before switching users, so the mountpoint underneath it is already
# writable regardless of what Docker sets on the volume itself.
# Owner-only (0700): the volume holds member data — uploaded avatars (data/avatars) — so nothing
# else in the container, nor another UID, should read it.
RUN mkdir -p /app/data/avatars && chown -R passport:passport /app/data && chmod -R 700 /app/data

USER passport
EXPOSE 8030

# Plain Node, no curl, to avoid adding a system package just for this — checks the app's own
# /healthz (liveness only, see that route's own comment for why it doesn't check Authentik/
# Dolibarr too).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
	CMD node -e "require('http').get('http://127.0.0.1:8030/healthz', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "build/index.js"]
