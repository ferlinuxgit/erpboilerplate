import { checkAuthRuntimeConfiguration, getBuildSha } from "@/lib/runtime-config";

const SERVICE_NAME = "erpboilerplate";
const READINESS_TIMEOUT_MS = 1000;

type DatabaseReadiness = "ok" | "missing_configuration" | "unavailable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Una sola comprobación en vuelo y su resultado reutilizado unos segundos: la sonda es pública y
// sin límite de peticiones, así que nunca debe abrir conexiones nuevas por cada llamada.
const READINESS_CACHE_MS = 5_000;
let cached: { at: number; value: Promise<DatabaseReadiness> } | null = null;

async function probeDatabase(): Promise<DatabaseReadiness> {
  if (!process.env.DATABASE_URL) return "missing_configuration";
  try {
    const { db } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), READINESS_TIMEOUT_MS));
    await Promise.race([db.execute(sql`select 1 as ready`), timeout]);
    return "ok";
  } catch {
    return "unavailable";
  }
}

function checkDatabaseReadiness(): Promise<DatabaseReadiness> {
  if (!cached || Date.now() - cached.at > READINESS_CACHE_MS) cached = { at: Date.now(), value: probeDatabase() };
  return cached.value;
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
