FROM node:22-bookworm-slim AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm install -g npm@11.9.0
RUN npm ci --include=dev

FROM node:22-bookworm-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=1024

# Public build-time values. Runtime secrets must be configured in Coolify env vars.
ARG APP_ORIGIN=http://localhost:3000
ARG APP_PUBLIC_STRIPE_PRICE_ID=
# Optional browser Sentry DSN (public by design; inlined into the client bundle).
ARG NEXT_PUBLIC_SENTRY_DSN=

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    JWT_SECRET="build-placeholder-minimum-32-characters" \
    APP_URL="$APP_ORIGIN" \
    NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID="$APP_PUBLIC_STRIPE_PRICE_ID" \
    NEXT_PUBLIC_SENTRY_DSN="$NEXT_PUBLIC_SENTRY_DSN" \
    npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV WAIT_FOR_DATABASE=true
ENV DATABASE_WAIT_TIMEOUT_SECONDS=60

# Run as the unprivileged `node` user shipped with the official image. Files
# are copied with its ownership so `npm prune` and Next's runtime cache
# (.next/cache) work without root.
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/package-lock.json ./package-lock.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=node:node /app/scripts ./scripts
RUN chown node:node /app
USER node
RUN npm prune --omit=dev && npm cache clean --force

EXPOSE 3000

# Liveness only (/api/health does not touch the DB). curl is not present in
# the slim image, so use Node's fetch. start-period covers DB wait + migrations.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "scripts/docker-start.mjs"]
