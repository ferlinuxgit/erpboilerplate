import { NextResponse } from "next/server";
import { z } from "zod";

import { companySettings } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { recordAudit } from "@/server/audit";

const payloadSchema = z.object({
  taxpayerType: z.enum(["company", "individual"]),
  fiscalRegime: z.enum(["general", "recargo_equivalencia", "cash_accounting", "exempt"]),
  taxPeriodicity: z.enum(["monthly", "quarterly"]),
  siiEnabled: z.boolean(),
  prorrataPct: z.number().min(0).max(100),
});

/**
 * Perfil fiscal (cómo tributa la empresa). Solo toca sus propios campos y exige `fiscal.write`,
 * así que el gestor con rol de contable puede mantenerlo sin permisos de administración.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("fiscal.write");
    const raw = await readJsonBody(request);
    if (!raw) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ message: "Revisa los datos del perfil fiscal." }, { status: 400 });

    const values = { ...parsed.data, prorrataPct: parsed.data.prorrataPct.toFixed(3) };
    const row = await db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(companySettings)
        .values({ companyId: ctx.company.id, ...values })
        .onConflictDoUpdate({ target: companySettings.companyId, set: { ...values, updatedAt: new Date() } })
        .returning({ id: companySettings.id });
      await recordAudit({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: ctx.user.id,
        action: "fiscalProfile.update",
        entityName: "companySettings",
        entityId: saved.id,
        payload: values,
      }, tx);
      return saved;
    });
    return NextResponse.json({ id: row.id, ...parsed.data });
  } catch (error) {
    return handleRouteError(error, "fiscalProfile.update", "No se pudo guardar el perfil fiscal.");
  }
}
