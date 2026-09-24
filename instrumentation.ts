import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (!process.env.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    sendDefaultPii: false,
  });
}

// Reports errors from Server Components, Route Handlers, Server Actions and
// the proxy. It is a no-op when Sentry has not been initialised (no DSN).
export const onRequestError = Sentry.captureRequestError;
