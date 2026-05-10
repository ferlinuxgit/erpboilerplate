import { defineConfig } from "@playwright/test";

const port = process.env.PORT ?? "3000";
const databasePort = process.env.E2E_DATABASE_PORT ?? "55432";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  // The e2e suite runs against one shared PGlite-backed web server. Keep workers
  // serial so independent smoke specs do not race over the database socket.
  workers: 1,
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
