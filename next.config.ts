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
  // Los e2e compilan y sirven desde su propia carpeta para no pisar `.next` (dev o despliegue).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  serverExternalPackages: [
    "@aws-sdk/s3-request-presigner",
    "@upstash/ratelimit",
    "@upstash/redis",
    "drizzle-orm",
    "exceljs",
    "imapflow",
    "mailparser",
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
    // E2E (scripts/e2e-sandbox.mjs): Turbopack libera de RAM todo lo que ya ha guardado en su
    // caché de disco, para que `next dev` quepa en el límite de memoria del sandbox.
    ...(process.env.E2E_LOW_MEMORY === "1" ? { turbopackMemoryEviction: "full" as const } : {}),
  },
  // Pantallas de configuración que se unificaron en /settings: los enlaces antiguos siguen funcionando.
  async redirects() {
    return [
      { source: "/settings/masters", destination: "/settings", permanent: false },
      { source: "/fiscal/settings", destination: "/settings/fiscal", permanent: false },
      { source: "/invoices/collections/settings", destination: "/settings/payments#emails", permanent: false },
    ];
  },
  async headers() {
    const securityHeaders = (frameAncestors: string) => [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Content-Security-Policy",
        value: `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors ${frameAncestors}; img-src 'self' data: https:; connect-src ${connectSrc}; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; frame-src https://js.stripe.com https://hooks.stripe.com;`,
      },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    ];
    return [
      { source: "/((?!reservar(?:/|$)).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, ...securityHeaders("'none'")] },
      // El formulario público de reservas se puede incrustar en la web del restaurante.
      { source: "/reservar/:path*", headers: securityHeaders("*") },
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
