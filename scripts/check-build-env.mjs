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
    name: "JWT_SECRET",
    reason: "La autenticación propia firma y valida las sesiones JWT durante el runtime.",
    examplePaths: ["src/lib/auth.ts"],
  },
  {
    name: "APP_URL",
    reason: "Los enlaces de verificación, invitaciones y Stripe necesitan la URL canónica de la app.",
    examplePaths: ["src/app/api/auth/register/route.ts", "src/app/api/billing/checkout/route.ts"],
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
