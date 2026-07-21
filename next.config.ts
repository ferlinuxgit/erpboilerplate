import type { NextConfig } from "next";

const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"]),
  "https://js.stripe.com",
].join(" ");

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@aws-sdk/s3-request-presigner",
    "@upstash/ratelimit",
    "@upstash/redis",
    "drizzle-orm",
    "exceljs",
    "openai",
    "pdfjs-dist",
    "resend",
    "stripe",
    "tesseract.js",
    "zod",
  ],
  // TypeScript still runs as the first, isolated step of `npm run build`.
  // Skipping Next's duplicate in-process pass lets the compiler release its
  // memory before Turbopack starts, which is important on small Docker hosts.
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    // Keep production builds within the memory available on the deployment host.
    // Turbopack evicts cached work above this threshold instead of letting the
    // Docker builder grow until the host OOM killer terminates it.
    cpus: 1,
    turbopackMemoryLimit: 256 * 1024 * 1024,
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
            value: `default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https:; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; frame-src https://js.stripe.com https://hooks.stripe.com;`,
          },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
