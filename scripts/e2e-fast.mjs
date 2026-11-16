#!/usr/bin/env node
// E2E en local con Postgres real en Docker (datos en memoria, sin fsync): con PGlite sembrar
// ~1.600 subcuentas por empresa de test es muy lento.
//
// Cada fase pesada corre en su propio sandbox (scripts/e2e-sandbox.mjs: límites de memoria, CPU
// y tiempo) para que los e2e nunca puedan colgar el servidor, y solo hay una ejecución a la vez
// (scripts/e2e-lock.mjs). Van en serie por defecto: cada worker añade un Chromium.
//
// Los tests se sirven desde una compilación de producción (`next start`) en .next-e2e: se compila
// solo cuando cambia el código (~3 min) y durante los tests no se compila nada, lo que los hace
// ligeros y rápidos. La compilación (Turbopack, ~3,5-4 GB) necesita más memoria que los tests:
// tiene su propio límite (E2E_BUILD_MEMORY_MAX) y no arranca si el host no tiene esa memoria libre.
// E2E_SERVER_MODE=dev vuelve a `next dev` (sin compilación previa).
//
// Uso: npm run test:e2e:fast [-- <specs o args de playwright>]
// Variables: E2E_WORKERS (por defecto 1), E2E_GLOBAL_TIMEOUT_MS (por defecto 10 min),
//            E2E_SERVER_MODE (start | dev, por defecto start),
//            E2E_BUILD_MEMORY_MAX (por defecto 4608M), E2E_MEMORY_MAX (tests, por defecto 3584M).
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import { acquireE2eLock } from "./e2e-lock.mjs";

const CONTAINER = "erpboilerplate-e2e-pg";
const IMAGE = process.env.E2E_PG_IMAGE ?? "postgres:17-alpine";
const DATABASE = "erp_e2e";
// El contenedor vive fuera del scope del sandbox: se limita aparte.
const POSTGRES_LIMITS = ["--memory", "768m", "--memory-swap", "768m", "--cpus", "1"];

function docker(args, options = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...options });
}

function fail(message) {
  console.error(`e2e-fast: ${message}`);
  process.exit(1);
}

function ensurePostgres() {
  const running = docker(["inspect", "-f", "{{.State.Running}}", CONTAINER]);
  if (running.status === 0 && running.stdout.trim() === "true") {
    // Contenedores creados antes de los límites: se aplican en caliente.
    docker(["update", ...POSTGRES_LIMITS, CONTAINER]);
    return;
  }
  docker(["rm", "-f", CONTAINER]);
  const started = docker([
    "run", "-d", "--name", CONTAINER,
    "-e", "POSTGRES_PASSWORD=postgres",
    "--tmpfs", "/var/lib/postgresql/data",
    ...POSTGRES_LIMITS,
    // Docker elige un puerto libre del host; se lee después con `docker port`.
    "-p", "127.0.0.1::5432",
    IMAGE,
    // Solo para tests: velocidad antes que durabilidad.
    "-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off", "-c", "max_connections=50", "-c", "shared_buffers=64MB",
  ]);
  if (started.status !== 0) fail(`no se pudo arrancar Postgres en Docker:\n${started.stderr}`);
}

function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (docker(["exec", CONTAINER, "pg_isready", "-U", "postgres"]).status === 0) return;
    spawnSync("sleep", ["0.5"]);
  }
  fail("Postgres no respondió a tiempo.");
}

function resetDatabase() {
  for (const sql of [`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`, `CREATE DATABASE ${DATABASE}`]) {
    const result = docker(["exec", CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql]);
    if (result.status !== 0) fail(`no se pudo preparar la base de datos:\n${result.stderr}`);
  }
}

function postgresPort() {
  const result = docker(["port", CONTAINER, "5432/tcp"]);
  const port = result.stdout.trim().split("\n")[0]?.split(":").pop();
  if (result.status !== 0 || !port) fail(`no se pudo leer el puerto de Postgres:\n${result.stderr}`);
  return port;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const DIST_DIR = ".next-e2e";
// Lo que cambia la compilación: código, estáticos, configuración y dependencias.
const BUILD_INPUTS = ["src", "public", "next.config.ts", "package-lock.json", "tsconfig.json", "postcss.config.mjs", ".env", ".env.local"];

function newestMtime(target) {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    return 0;
  }
  if (!stats.isDirectory()) return stats.mtimeMs;
  let newest = stats.mtimeMs;
  for (const entry of readdirSync(target)) newest = Math.max(newest, newestMtime(path.join(target, entry)));
  return newest;
}

function buildIsFresh() {
  let builtAt;
  try {
    builtAt = statSync(path.join(DIST_DIR, "BUILD_ID")).mtimeMs;
  } catch {
    return false;
  }
  return BUILD_INPUTS.every((input) => newestMtime(input) <= builtAt);
}

const BUILD_MEMORY_MAX = process.env.E2E_BUILD_MEMORY_MAX ?? "4608M";
const SANDBOX = path.join(path.dirname(new URL(import.meta.url).pathname), "e2e-sandbox.mjs");

function megabytes(value) {
  const match = /^(\d+(?:\.\d+)?)([MG])$/i.exec(value.trim());
  if (!match) fail(`E2E_BUILD_MEMORY_MAX no válido (${value}). Ejemplos: 4608M, 5G.`);
  return Number(match[1]) * (match[2].toUpperCase() === "G" ? 1024 : 1);
}

function availableMegabytes() {
  const kb = Number(/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo", "utf8"))?.[1]);
  return kb ? kb / 1024 : Infinity;
}

function buildForTests(databaseUrl) {
  if (buildIsFresh()) {
    console.log(`e2e-fast: compilación de ${DIST_DIR} al día, se reutiliza.`);
    return;
  }
  // Margen de 1 GB para el resto del host: si no lo hay, mejor no empezar que estrangularlo.
  const needed = megabytes(BUILD_MEMORY_MAX) + 1024;
  const available = availableMegabytes();
  if (available < needed) {
    fail(
      `la compilación para los tests necesita ~${Math.round(needed / 1024)} GB libres y el host tiene ${(available / 1024).toFixed(1)} GB.\n` +
        "Prueba más tarde o usa E2E_SERVER_MODE=dev (sin compilación previa, para un spec suelto).",
    );
  }
  console.log(`e2e-fast: compilando la app para los tests en ${DIST_DIR} (solo cuando cambia el código, límite ${BUILD_MEMORY_MAX})…`);
  const built = spawnSync("node", [SANDBOX, "npx", "next", "build"], {
    stdio: "inherit",
    env: {
      ...env,
      E2E_MEMORY_MAX: BUILD_MEMORY_MAX,
      E2E_MAX_MINUTES: process.env.E2E_BUILD_MAX_MINUTES ?? "12",
      NEXT_DIST_DIR: DIST_DIR,
      NEXT_TELEMETRY_DISABLED: "1",
      // Nunca contra la base de datos de desarrollo, aunque .env la defina.
      DATABASE_URL: databaseUrl,
    },
  });
  if (built.status !== 0) fail("la compilación para los tests ha fallado.");
}

if (!acquireE2eLock("e2e-fast")) process.exit(1);

ensurePostgres();
waitForPostgres();
resetDatabase();

const port = String(process.env.PORT ?? (await freePort()));
const env = { ...process.env };
delete env.NO_COLOR;
const serverMode = process.env.E2E_SERVER_MODE === "dev" ? "dev" : "start";
const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${postgresPort()}/${DATABASE}`;
if (serverMode === "start") buildForTests(databaseUrl);

const child = spawn("node", [SANDBOX, "npx", "playwright", "test", ...process.argv.slice(2)], {
  env: {
    ...env,
    PORT: port,
    APP_URL: `http://127.0.0.1:${port}`,
    E2E_DATABASE_URL: databaseUrl,
    E2E_SERVER_MODE: serverMode,
    ...(serverMode === "start" ? { NEXT_DIST_DIR: DIST_DIR } : {}),
    E2E_WORKERS: process.env.E2E_WORKERS ?? "1",
    E2E_GLOBAL_TIMEOUT_MS: process.env.E2E_GLOBAL_TIMEOUT_MS ?? String(10 * 60_000),
  },
  stdio: "inherit",
});

// Una interrupción llega a Playwright, que cierra el servidor web y los navegadores.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal === "SIGHUP" ? "SIGTERM" : signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
