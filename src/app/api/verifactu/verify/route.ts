import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { verifyCompanyChain } from "@/server/verifactu/verify";

/** "Verificar integridad": recalcula todas las huellas y enlaces y lo anota en el registro de eventos. */
export async function POST() {
  try {
    const ctx = await requireContext("fiscal.write");
    const result = await verifyCompanyChain(ctx.company.id, ctx.user.id);
    await recordAudit({
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      actorUserId: ctx.user.id,
      action: "verifactu.verify",
      entityName: "verifactuRecord",
      entityId: ctx.company.id,
      payload: { ok: result.ok, recordCount: result.recordCount, anomalies: result.anomalies.length },
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "verifactu.verify", "No se pudo verificar la cadena de registros.");
  }
}
