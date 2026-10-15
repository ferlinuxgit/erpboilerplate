import { defineConfig } from "@playwright/test";

const port = process.env.PORT ?? "3000";
const databasePort = process.env.E2E_DATABASE_PORT ?? "0";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";
// PGlite shares a single database session across connections, so the default stays
// serial. Against a real Postgres (scripts/e2e-fast.mjs, E2E_DATABASE_URL) specs are
// isolated by their own user/company and can run in parallel via E2E_WORKERS.
const workers = Number.parseInt(process.env.E2E_WORKERS ?? "1", 10) || 1;
const globalTimeout = Number.parseInt(process.env.E2E_GLOBAL_TIMEOUT_MS ?? "0", 10) || 0;

export default defineConfig({
  testDir: "./tests/e2e",
  workers,
  // Hard cap for the whole run (0 = none) so a hung test can never stall a session.
  globalTimeout,
  // Next dev route compilation plus full user journeys can exceed Playwright's
  // default 30s test timeout on CI matrix workers even when the app is healthy.
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["./tests/e2e/skip-policy-reporter.ts"]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: skipWebServer
    ? undefined
    : {
        command: `PORT=${port} E2E_DATABASE_PORT=${databasePort} node scripts/e2e-with-pglite.mjs`,
        reuseExistingServer: false,
        timeout: 120_000,
        url: baseURL,
      },
});
