import * as Sentry from "@sentry/nextjs";

// NEXT_PUBLIC_* values are inlined at build time, so the DSN must be present
// when `next build` runs (see documentation/deploy.md).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
  });
}

// Safe without a DSN: the SDK ignores transitions when no client is active.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
