#!/usr/bin/env node

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

const requiredEnv = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_BETTER_AUTH_URL",
];

const waitForDatabase = process.env.WAIT_FOR_DATABASE !== "false";
const runMigrations = process.env.RUN_MIGRATIONS_ON_START === "true";
const databaseWaitTimeoutSeconds = Number.parseInt(process.env.DATABASE_WAIT_TIMEOUT_SECONDS ?? "60", 10);

function validateRuntimeEnv() {
  const missing = requiredEnv.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    console.error("Runtime environment validation failed.");
    for (const name of missing) {
      console.error(`- ${name} is required.`);
    }
    process.exit(1);
  }

  const secret = process.env.BETTER_AUTH_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    console.error("BETTER_AUTH_SECRET must be at least 32 characters for production-grade deployments.");
    process.exit(1);
  }

  if (process.env.NODE_ENV === "production") {
    for (const name of ["BETTER_AUTH_URL", "NEXT_PUBLIC_BETTER_AUTH_URL"]) {
      const value = process.env[name] ?? "";
      if (value.startsWith("http://") && !value.includes("localhost") && !value.includes("127.0.0.1")) {
        console.warn(`${name} uses http:// in production. Use https:// for public deployments.`);
      }
    }

    if ((process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "") !== (process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "").replace(/\/+$/, "")) {
      console.error("BETTER_AUTH_URL and NEXT_PUBLIC_BETTER_AUTH_URL must match in production.");
      process.exit(1);
    }
  }
}

async function waitUntilDatabaseIsReady() {
  if (!waitForDatabase) {
    console.log("Database wait skipped because WAIT_FOR_DATABASE=false.");
    return;
  }

  const timeoutMs = Number.isFinite(databaseWaitTimeoutSeconds) && databaseWaitTimeoutSeconds > 0
    ? databaseWaitTimeoutSeconds * 1000
    : 60_000;
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown error";

  while (Date.now() < deadline) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 1000,
      max: 1,
      query_timeout: 2500,
      statement_timeout: 2500,
    });

    try {
      await pool.query("select 1");
      await pool.end();
      console.log("Database is ready.");
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await pool.end().catch(() => undefined);
      await sleep(2000);
    }
  }

  console.error(`Database did not become ready within ${Math.round(timeoutMs / 1000)}s: ${lastError}`);
  process.exit(1);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}

async function runStartupMigrations() {
  if (!runMigrations) {
    console.log("Database migrations skipped because RUN_MIGRATIONS_ON_START is not true.");
    return;
  }

  console.log("Running database migrations before starting the app.");
  await runCommand("npm", ["run", "db:migrate"]);
}

function startNext() {
  const children = [];
  if (process.env.OCR_WORKER_ENABLED === "true") {
    const worker = spawn("npm", ["run", "ocr:worker"], {
      stdio: "inherit",
      shell: false,
    });
    children.push(worker);
  }

  const child = spawn("npm", ["run", "start"], {
    stdio: "inherit",
    shell: false,
  });
  children.push(child);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      for (const currentChild of children) currentChild.kill(signal);
    });
  }

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

validateRuntimeEnv();
await waitUntilDatabaseIsReady();
await runStartupMigrations();
startNext();
