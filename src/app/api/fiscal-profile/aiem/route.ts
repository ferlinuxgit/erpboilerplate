import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { tax } from "@/db/schema";
import { AIEM_RATES } from "@/lib/country-packs/igic";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";

const payloadSchema = z.object({ enabled: z.boolean() });

/**
 * AIEM (Canarias): al activarlo se crean sus tipos (5, 10, 15 y 25 %, art. 3 Ley 4/2014) como
 * impuestos que suman en la factura, para las entregas de mercancías sujetas; al desactivarlo se
 * desactivan (no se borran: siguen en las facturas emitidas). El modelo 450 aparece solo si está activo.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("fiscal.write");
    const raw = await readJsonBody(request);
    if (!raw) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ message: "Indica si activas el AIEM." }, { status: 400 });
    if ((await getCompanyTaxTerritory(ctx.company.id)) !== "ES-CN") {
      return NextResponse.json({ message: "El AIEM solo existe en Canarias." }, { status: 422 });
    }
    const { enabled } = parsed.data;
    await db.transaction(async (tx) => {
      if (enabled) {
        await tx
          .insert(tax)
          .values(AIEM_RATES.map((rate) => ({ companyId: ctx.company.id, name: `AIEM ${String(rate).replace(".", ",")}%`, rate: rate.toFixed(3), kind: "OTHER", operation: "ADD", isDefault: false, isActive: true })))
          .onConflictDoUpdate({ target: [tax.companyId, tax.name], set: { isActive: true, kind: "OTHER", operation: "ADD", updatedAt: new Date() } });
      } else {
        await tx
          .update(tax)
          .set({ isActive: false, isDefault: false, updatedAt: new Date() })
          .where(and(eq(tax.companyId, ctx.company.id), eq(tax.kind, "OTHER"), sql`upper(${tax.name}) LIKE 'AIEM%'`));
      }
      await recordAudit({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: ctx.user.id,
        action: "fiscalProfile.aiem",
        entityName: "company",
        entityId: ctx.company.id,
        payload: { enabled },
      }, tx);
    });
    return NextResponse.json({ enabled });
  } catch (error) {
    return handleRouteError(error, "fiscalProfile.aiem", "No se pudo guardar el AIEM.");
  }
}
