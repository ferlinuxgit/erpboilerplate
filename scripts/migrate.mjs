#!/usr/bin/env node
// Aplica las migraciones pendientes de ./drizzle (las genera `npm run db:generate`).
//
// - Solo usa dependencias de producción (pg + drizzle-orm): funciona dentro de la imagen Docker,
//   donde drizzle-kit (dependencia de desarrollo) no está instalado.
// - Misma tabla de control y misma lógica que drizzle-kit (`drizzle.__drizzle_migrations`, hash
//   SHA-256 del fichero y `created_at` = `when` del journal): es compatible con bases ya migradas
//   con `drizzle-kit migrate`.
// - Todo va en UNA transacción con un bloqueo transaccional (pg_advisory_xact_lock): si arrancan
//   varias réplicas a la vez solo una aplica las migraciones y el resto espera y no hace nada.
//   El bloqueo transaccional funciona también a través de poolers en modo transacción
//   (PgBouncer), donde un bloqueo de sesión no es fiable. Si algo falla, no se aplica nada.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";
// Clave fija del bloqueo (cualquier entero de 64 bits; identifica "migraciones de este ERP").
const MIGRATION_LOCK_KEY = 4_815_162_342;

/** Migraciones aún no aplicadas: posteriores a la última registrada (igual que drizzle). */
export function pendingMigrations(migrations, lastAppliedCreatedAt) {
  if (lastAppliedCreatedAt === null || lastAppliedCreatedAt === undefined) return migrations;
  return migrations.filter((migration) => Number(lastAppliedCreatedAt) < migration.folderMillis);
}

export async function runMigrations({ connectionString, migrationsFolder, log = console.log }) {
  const migrations = readMigrationFiles({ migrationsFolder });
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await client.query(`CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
    const { rows } = await client.query(`SELECT created_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`);
    const pending = pendingMigrations(migrations, rows[0]?.created_at ?? null);
    for (const migration of pending) {
      for (const statement of migration.sql) {
        if (statement.trim()) await client.query(statement);
      }
      await client.query(`INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES ($1, $2)`, [migration.hash, migration.folderMillis]);
    }
    await client.query("COMMIT");
    log(pending.length === 0
      ? `Base de datos al día (${migrations.length} migraciones).`
      : `Aplicadas ${pending.length} migraciones; base de datos al día (${migrations.length}).`);
    return { applied: pending.length, total: migrations.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  // En local, DATABASE_URL suele estar en .env; en Docker llega como variable de entorno.
  if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL no está definida.");
    process.exit(1);
  }
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  try {
    await runMigrations({ connectionString: process.env.DATABASE_URL, migrationsFolder });
  } catch (error) {
    console.error(`Las migraciones han fallado y no se ha aplicado ninguna: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
