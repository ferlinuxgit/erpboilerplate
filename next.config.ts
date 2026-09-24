import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
  "https://js.stripe.com",
].join(" ");

// Browser Sentry (instrumentation-client.ts) posts events straight to the
// ingest host of NEXT_PUBLIC_SENTRY_DSN, so allow that origin in connect-src.
function sentryIngestOrigin() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

const connectSrc = ["'self'", sentryIngestOrigin()].filter(Boolean).join(" ");

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@aws-sdk/s3-request-presigner",
    "@upstash/ratelimit",
    "@upstash/redis",
    "drizzle-orm",
    "exceljs",
    "openai",
    "pdfjs-dist",
    "nodemailer",
    "stripe",
    "tesseract.js",
    "zod",
  ],
  // Type errors still block releases: `npm run build` runs `tsc --noEmit`
  // (npm run typecheck) as its first step and CI runs it too. Skipping Next's
  // duplicate pass avoids a second full typecheck competing for memory with
  // Turbopack on small Docker hosts. Do not call `next build` directly.
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Keep production builds within the memory available on the deployment
    // host (a single build worker). Next 16.3 removed
    // `experimental.turbopackMemoryLimit`; the Docker builder additionally caps
    // the Node heap via NODE_OPTIONS.
    cpus: 1,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https:; connect-src ${connectSrc}; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; frame-src https://js.stripe.com https://hooks.stripe.com;`,
          },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

// Works without Sentry credentials: source maps are only generated/uploaded
// (and releases created) when SENTRY_AUTH_TOKEN, SENTRY_ORG and
// SENTRY_PROJECT are provided at build time.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: sentryAuthToken,
  silent: true,
  telemetry: false,
  sourcemaps: {
    disable: !sentryAuthToken,
  },
  release: {
    create: Boolean(sentryAuthToken),
  },
});
