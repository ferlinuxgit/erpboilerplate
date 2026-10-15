import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "pglite-server";

const root = process.cwd();
const requestedDatabasePort = Number.parseInt(process.env.E2E_DATABASE_PORT ?? "0", 10);

if (!Number.isInteger(requestedDatabasePort) || requestedDatabasePort < 0) {
  throw new Error(`Invalid E2E_DATABASE_PORT: ${process.env.E2E_DATABASE_PORT}`);
}

// With an external test database (CI service, scripts/e2e-fast.mjs) PGlite is not needed.
const externalDatabaseUrl = process.env.E2E_DATABASE_URL;
let pgServer = null;
let databaseUrl = externalDatabaseUrl;

if (!externalDatabaseUrl) {
  const db = new PGlite();
  await db.waitReady;

  pgServer = createServer(db);

  await new Promise((resolve, reject) => {
    pgServer.once("error", reject);
    pgServer.listen(requestedDatabasePort, "127.0.0.1", () => {
      pgServer.off("error", reject);
      resolve();
    });
  });

  const address = pgServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve PGlite server address.");
  }

  databaseUrl = `postgres://postgres:postgres@127.0.0.1:${address.port}/postgres`;
}

const closeDatabase = (callback) => (pgServer ? pgServer.close(callback) : callback());

const child = spawn("node", ["scripts/e2e-web-server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    // E2E is isolated from the build/runtime DATABASE_URL by default. Opt in to
    // an external test database explicitly; never let tests mutate production.
    DATABASE_URL: databaseUrl,
    PGSSLMODE: "disable",
  },
  stdio: "inherit",
});

const shutdown = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
  closeDatabase(() => undefined);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

child.on("exit", (code, signal) => {
  closeDatabase(() => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
});
