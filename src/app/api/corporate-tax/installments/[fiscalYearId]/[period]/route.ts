import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { isInstallmentPeriod } from "@/server/corporate-tax/installments-model";
import { installmentSchema } from "@/server/corporate-tax/schemas";
import { assertCorporateTaxCompany, saveInstallment } from "@/server/corporate-tax/service";

/**
 * Guarda el cálculo de un pago fraccionado (periodo 1P, 2P o 3P): modalidad, ajustes del periodo,
 * bonificaciones y retenciones. Con `filed: true` lo marca como presentado y con `filed: false` lo
 * reabre. Importes en céntimos. El modelo 202 se presenta en la sede de la AEAT.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ fiscalYearId: string; period: string }> }) {
  try {
    const { ctx, user } = await requirePermission("fiscal.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { fiscalYearId, period } = await params;
    if (!isInstallmentPeriod(period)) return NextResponse.json({ message: "El periodo debe ser 1P, 2P o 3P." }, { status: 400 });
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = installmentSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    return NextResponse.json(await saveInstallment({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, fiscalYearId, period, parsed.data));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.installment.save", "No se pudo guardar el pago fraccionado. Inténtalo de nuevo.");
  }
}
