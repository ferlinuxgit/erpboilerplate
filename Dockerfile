FROM node:22-bookworm-slim AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm install -g npm@11.9.0
RUN npm ci --include=dev

FROM node:22-bookworm-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Public build-time values. Runtime secrets must be configured in Coolify env vars.
ARG APP_ORIGIN=http://localhost:3000
ARG APP_PUBLIC_ORIGIN=http://localhost:3000
ARG APP_PUBLIC_STRIPE_PRICE_ID=

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build" \
    BETTER_AUTH_SECRET="build-placeholder-minimum-32-characters" \
    BETTER_AUTH_URL="$APP_ORIGIN" \
    NEXT_PUBLIC_BETTER_AUTH_URL="$APP_PUBLIC_ORIGIN" \
    NEXT_PUBLIC_DEFAULT_STRIPE_PRICE_ID="$APP_PUBLIC_STRIPE_PRICE_ID" \
    npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV WAIT_FOR_DATABASE=true
ENV DATABASE_WAIT_TIMEOUT_SECONDS=60

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/scripts ./scripts
RUN npm prune --omit=dev && npm cache clean --force

EXPOSE 3000

CMD ["node", "scripts/docker-start.mjs"]
