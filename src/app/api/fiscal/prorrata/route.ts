import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { companySettings } from "@/db/schema";
import { getCountryFiscalProfile } from "@/lib/country-packs/profile";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { getCompanyTaxTerritory } from "@/server/company/fiscal-context";
import { normalizeVatProrataFinal } from "@/server/fiscal/prorrata";

const payloadSchema = z.object({
  year: z.number().int().min(2000).max(2099),
  // Porcentaje definitivo de prorrata del ejercicio (entero, art. 104.Dos LIVA); null lo quita.
  pct: z.number().int().min(0).max(100).nullable(),
});

/**
 * Confirma (o retira) el porcentaje definitivo de prorrata de un ejercicio. Con él, el último 303
 * del año y el 390 regularizan las deducciones provisionales (casillas 44 y 43; 522 y 63).
 * Solo toca ese ejercicio dentro de `company_settings.vatProrataFinal`.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireContext("fiscal.write");
    const territory = await getCompanyTaxTerritory(ctx.company.id);
    if (!getCountryFiscalProfile(territory).features.taxReports) {
      return NextResponse.json({ message: "La prorrata definitiva no está disponible para el país de esta empresa." }, { status: 404 });
    }
    const raw = await readJsonBody(request);
    if (!raw) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ message: "Indica el ejercicio y un porcentaje entero entre 0 y 100." }, { status: 400 });

    const { year, pct } = parsed.data;
    const saved = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: companySettings.id, vatProrataFinal: companySettings.vatProrataFinal })
        .from(companySettings)
        .where(eq(companySettings.companyId, ctx.company.id))
        .limit(1)
        .for("update");
      const merged: Record<string, string> = Object.fromEntries(Object.entries(normalizeVatProrataFinal(existing?.vatProrataFinal)).map(([key, value]) => [key, String(value)]));
      if (pct === null) delete merged[String(year)];
      else merged[String(year)] = String(pct);
      const [row] = await tx
        .insert(companySettings)
        .values({ companyId: ctx.company.id, vatProrataFinal: merged })
        .onConflictDoUpdate({ target: companySettings.companyId, set: { vatProrataFinal: merged, updatedAt: new Date() } })
        .returning({ id: companySettings.id });
      await recordAudit({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: ctx.user.id,
        action: "fiscalProfile.prorrataFinal",
        entityName: "companySettings",
        entityId: row.id,
        payload: { year, pct },
      }, tx);
      return merged;
    });
    return NextResponse.json({ year, pct, vatProrataFinal: saved });
  } catch (error) {
    return handleRouteError(error, "fiscalProfile.prorrataFinal", "No se pudo guardar la prorrata definitiva.");
  }
}
