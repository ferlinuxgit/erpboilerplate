import { spawn, spawnSync } from "node:child_process";

const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Run this through pglite-server --include-database-url.");
}

const push = spawnSync("npx", ["drizzle-kit", "push", "--force"], {
  cwd: root,
  env: { ...process.env, PGSSLMODE: "disable" },
  stdio: "inherit",
});

if (push.status !== 0) {
  process.exit(push.status ?? 1);
}

const port = process.env.PORT ?? "3000";
const authUrl = process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${port}`;
const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", port], {
  cwd: root,
  env: {
    ...process.env,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "playwright-e2e-secret-minimum-32-characters",
    BETTER_AUTH_URL: authUrl,
    NEXT_PUBLIC_BETTER_AUTH_URL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? authUrl,
    NEXT_TELEMETRY_DISABLED: "1",
    PGSSLMODE: "disable",
  },
  stdio: "inherit",
});

const shutdown = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
