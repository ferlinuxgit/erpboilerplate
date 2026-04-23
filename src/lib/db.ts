import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";

type AppDb = ReturnType<typeof drizzle>;

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
  db: AppDb | undefined;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL no está definida en variables de entorno.");
}

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString,
  });

export const db = globalForDb.db ?? drizzle(pool, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
  globalForDb.db = db;
}
