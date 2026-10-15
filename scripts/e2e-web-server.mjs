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
const appUrl = process.env.APP_URL ?? `http://127.0.0.1:${port}`;
// "start": sirve la compilación de producción ya hecha (scripts/e2e-fast.mjs la prepara en
// NEXT_DIST_DIR): nada se compila durante los tests, así que consumen mucha menos memoria y CPU.
// "dev" (por defecto, CI): `next dev`, que compila cada ruta la primera vez que se visita.
const serverArgs = process.env.E2E_SERVER_MODE === "start"
  ? ["next", "start", "--hostname", "127.0.0.1", "--port", port]
  : ["npm", "run", "dev", "--", "--hostname", "127.0.0.1", "--port", port];
const child = spawn(serverArgs[0] === "next" ? "npx" : serverArgs[0], serverArgs[0] === "next" ? serverArgs : serverArgs.slice(1), {
  cwd: root,
  env: {
    ...process.env,
    JWT_SECRET: process.env.JWT_SECRET ?? "playwright-e2e-secret-minimum-32-characters",
    APP_URL: appUrl,
    NEXT_TELEMETRY_DISABLED: "1",
    PGSSLMODE: "disable",
    // En modo producción (`next start`) el registro exige verificar el email; los tests no envían correo.
    REQUIRE_EMAIL_VERIFICATION: process.env.REQUIRE_EMAIL_VERIFICATION ?? "false",
    // Every spec registers users from 127.0.0.1; keep rate limiting active but roomy.
    RATE_LIMIT_MULTIPLIER: process.env.RATE_LIMIT_MULTIPLIER ?? "100",
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
