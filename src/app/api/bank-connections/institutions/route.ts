import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { listBankInstitutions } from "@/server/bank-connections/service";

/** Bancos españoles disponibles para la conexión PSD2 (solo nombre, id y logo). */
export async function GET() {
  try {
    await requirePermission("treasury.write", "Tu rol no permite conectar bancos.");
    const rows = await listBankInstitutions("ES");
    return NextResponse.json(rows.map((row) => ({ id: row.id, name: row.name, bic: row.bic ?? null, logo: row.logo ?? null })));
  } catch (error) {
    return handleRouteError(error, "bank_connections.institutions", "No se pudo cargar la lista de bancos.");
  }
}
