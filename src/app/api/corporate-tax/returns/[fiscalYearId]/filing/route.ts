import { NextResponse } from "next/server";

import { handleRouteError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { fileCorporateTaxReturnSchema } from "@/server/corporate-tax/schemas";
import { assertCorporateTaxCompany, markCorporateTaxReturnFiled, reopenCorporateTaxReturn } from "@/server/corporate-tax/service";

type Params = { params: Promise<{ fiscalYearId: string }> };

/**
 * Marca la liquidación como presentada (el modelo 200 se presenta fuera, con Sociedades WEB) y
 * guarda la foto del cálculo: de ella salen las bases negativas a compensar en ejercicios siguientes.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { ctx, user } = await requirePermission("fiscal.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const parsed = fileCorporateTaxReturnSchema.safeParse((await readJsonBody(request)) ?? {});
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const { fiscalYearId } = await params;
    return NextResponse.json(await markCorporateTaxReturnFiled({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, fiscalYearId, parsed.data));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.return.file", "No se pudo marcar la liquidación como presentada.");
  }
}

/** Reabre una liquidación marcada como presentada para poder cambiarla. */
export async function DELETE(_: Request, { params }: Params) {
  try {
    const { ctx, user } = await requirePermission("fiscal.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { fiscalYearId } = await params;
    return NextResponse.json(await reopenCorporateTaxReturn({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, fiscalYearId));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.return.reopen", "No se pudo reabrir la liquidación.");
  }
}
