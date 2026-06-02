#!/usr/bin/env node

const baseUrl = process.env.APP_URL?.trim();

if (!baseUrl) {
  console.error("APP_URL is required. Example: APP_URL=https://erp.example.com npm run deploy:smoke");
  process.exit(1);
}

const checks = [
  { path: "/api/health", expectStatus: 200, expectJsonStatus: "ok" },
  { path: "/api/readyz", expectStatus: 200, expectJsonStatus: "ok" },
  { path: "/", expectStatus: 200 },
  { path: "/auth/login", expectStatus: 200 },
];

for (const check of checks) {
  const url = new URL(check.path, normalizeBaseUrl(baseUrl)).toString();
  const response = await fetch(url, { redirect: "follow" });

  if (response.status !== check.expectStatus) {
    console.error(`${check.path} returned ${response.status}, expected ${check.expectStatus}.`);
    process.exit(1);
  }

  if (check.expectJsonStatus) {
    const body = await response.json();
    if (body.status !== check.expectJsonStatus) {
      console.error(`${check.path} returned status=${body.status}, expected ${check.expectJsonStatus}.`);
      process.exit(1);
    }
  } else {
    await response.arrayBuffer();
  }
}

console.log(`Production smoke passed for ${normalizeBaseUrl(baseUrl)}`);

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
