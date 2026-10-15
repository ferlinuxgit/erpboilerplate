#!/usr/bin/env node
// E2E en local con Postgres real en Docker (datos en memoria, sin fsync): con PGlite sembrar
// ~1.600 subcuentas por empresa de test es muy lento.
//
// Se lanza siempre a través de scripts/e2e-sandbox.mjs (npm run test:e2e:fast), que limita
// memoria y CPU para que los e2e nunca puedan colgar el servidor. Por eso va en serie por
// defecto: cada worker añade un Chromium y más rutas compilando a la vez en `next dev`.
//
// Los tests se sirven desde una compilación de producción (`next start`) en .next-e2e: se compila
// solo cuando cambia el código (~1 min) y durante los tests no se compila nada, lo que los hace
// ligeros y rápidos. E2E_SERVER_MODE=dev vuelve a `next dev`.
//
// Uso: npm run test:e2e:fast [-- <specs o args de playwright>]
// Variables: E2E_WORKERS (por defecto 1), E2E_GLOBAL_TIMEOUT_MS (por defecto 10 min),
//            E2E_SERVER_MODE (start | dev, por defecto start).
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";

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

function buildForTests(databaseUrl) {
  if (buildIsFresh()) {
    console.log(`e2e-fast: compilación de ${DIST_DIR} al día, se reutiliza.`);
    return;
  }
  console.log(`e2e-fast: compilando la app para los tests en ${DIST_DIR} (solo cuando cambia el código)…`);
  const built = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    env: {
      ...env,
      NEXT_DIST_DIR: DIST_DIR,
      NEXT_TELEMETRY_DISABLED: "1",
      // Nunca contra la base de datos de desarrollo, aunque .env la defina.
      DATABASE_URL: databaseUrl,
    },
  });
  if (built.status !== 0) fail("la compilación para los tests ha fallado.");
}

ensurePostgres();
waitForPostgres();
resetDatabase();

const port = String(process.env.PORT ?? (await freePort()));
const env = { ...process.env };
delete env.NO_COLOR;
const serverMode = process.env.E2E_SERVER_MODE === "dev" ? "dev" : "start";
const databaseUrl = `postgres://postgres:postgres@127.0.0.1:${postgresPort()}/${DATABASE}`;
if (serverMode === "start") buildForTests(databaseUrl);

const child = spawn("npx", ["playwright", "test", ...process.argv.slice(2)], {
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
