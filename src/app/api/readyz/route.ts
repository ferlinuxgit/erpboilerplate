import { Pool } from "pg";

import { checkAuthRuntimeConfiguration, getBuildSha } from "@/lib/runtime-config";

const SERVICE_NAME = "erpboilerplate";
const READINESS_TIMEOUT_MS = 1000;

type DatabaseReadiness = "ok" | "missing_configuration" | "unavailable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function checkDatabaseReadiness(): Promise<DatabaseReadiness> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return "missing_configuration";
  }

  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: READINESS_TIMEOUT_MS,
    idleTimeoutMillis: READINESS_TIMEOUT_MS,
    max: 1,
    query_timeout: READINESS_TIMEOUT_MS,
    statement_timeout: READINESS_TIMEOUT_MS,
  });

  try {
    await pool.query("select 1 as ready");
    return "ok";
  } catch {
    return "unavailable";
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function GET() {
  const database = await checkDatabaseReadiness();
  const auth = checkAuthRuntimeConfiguration();
  const isReady = database === "ok" && auth === "ok";

  return Response.json(
    {
      service: SERVICE_NAME,
      status: isReady ? "ok" : "degraded",
      checks: {
        database,
        auth,
      },
      version: {
        sha: getBuildSha(),
      },
    },
    { status: isReady ? 200 : 503 },
  );
}
