import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { corporateTaxReturnSchema } from "@/server/corporate-tax/schemas";
import { assertCorporateTaxCompany, getCorporateTaxYear, saveCorporateTaxReturn } from "@/server/corporate-tax/service";

type Params = { params: Promise<{ fiscalYearId: string }> };

/**
 * Liquidación del Impuesto sobre Sociedades (modelo 200) del ejercicio: del resultado contable a la
 * cuota diferencial, con los ajustes guardados, las bases negativas pendientes, el asiento propuesto
 * y la conciliación con la contabilidad. Importes en céntimos. Solo sociedades.
 */
export async function GET(_: Request, { params }: Params) {
  try {
    const { ctx } = await requirePermission("fiscal.read");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { fiscalYearId } = await params;
    return NextResponse.json(await getCorporateTaxYear(ctx.company.id, fiscalYearId));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.return.get", "No se pudo calcular la liquidación del Impuesto sobre Sociedades.");
  }
}

/**
 * Guarda los datos de la liquidación del ejercicio (tipo de gravamen, ajustes extracontables,
 * reservas, compensación de bases negativas, deducciones y retenciones). Importes en céntimos.
 * No presenta nada en la AEAT: el modelo 200 se presenta con Sociedades WEB.
 */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { ctx, user } = await requirePermission("fiscal.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = corporateTaxReturnSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const { fiscalYearId } = await params;
    return NextResponse.json(await saveCorporateTaxReturn({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, fiscalYearId, parsed.data));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.return.save", "No se pudo guardar la liquidación. Inténtalo de nuevo.");
  }
}
