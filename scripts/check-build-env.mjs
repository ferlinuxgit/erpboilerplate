#!/usr/bin/env node

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), false);

const requiredBuildEnv = [
  {
    name: "DATABASE_URL",
    reason: "DB-backed App Router pages and route handlers are bundled during `next build`.",
    examplePaths: [
      "src/app/api/api-keys/route.ts",
      "src/app/settings/api-keys/page.tsx",
    ],
  },
  {
    name: "BETTER_AUTH_SECRET",
    reason: "Better Auth is initialized while auth-backed App Router modules are bundled.",
    examplePaths: ["src/lib/auth.ts", "src/app/api/auth/[...all]/route.ts"],
  },
  {
    name: "BETTER_AUTH_URL",
    reason: "Better Auth needs the canonical server-side app URL for callbacks and trusted origins.",
    examplePaths: ["src/lib/auth.ts", "src/app/api/billing/checkout/route.ts"],
  },
  {
    name: "NEXT_PUBLIC_BETTER_AUTH_URL",
    reason: "Client-side auth code needs the public app URL used by browser bundles.",
    examplePaths: ["src/lib/auth-client.ts"],
  },
];

const missing = requiredBuildEnv.filter(({ name }) => !process.env[name]?.trim());

if (missing.length > 0) {
  console.error("Build environment preflight failed.");
  console.error("`npm run build` requires the following environment variables before Next.js starts page data collection:");
  for (const variable of missing) {
    console.error(`- ${variable.name}: ${variable.reason}`);
    console.error(`  Example build paths: ${variable.examplePaths.join(", ")}`);
  }
  console.error("Copy .env.example to .env.local/.env in local development or configure these variables in CI.");
  process.exit(1);
}

console.log("Build environment preflight passed.");
