import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "pglite-server";

const root = process.cwd();
const requestedDatabasePort = Number.parseInt(process.env.E2E_DATABASE_PORT ?? "0", 10);

if (!Number.isInteger(requestedDatabasePort) || requestedDatabasePort < 0) {
  throw new Error(`Invalid E2E_DATABASE_PORT: ${process.env.E2E_DATABASE_PORT}`);
}

const db = new PGlite();
await db.waitReady;

const pgServer = createServer(db);

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

const databasePort = address.port;
const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${databasePort}/postgres`;
const child = spawn("node", ["scripts/e2e-web-server.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? databaseUrl,
    PGSSLMODE: "disable",
  },
  stdio: "inherit",
});

const shutdown = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
  pgServer.close(() => undefined);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

child.on("exit", (code, signal) => {
  pgServer.close(() => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
});
