import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { isInstallmentPeriod } from "@/server/corporate-tax/installments-model";
import { payInstallmentSchema } from "@/server/corporate-tax/schemas";
import { assertCorporateTaxCompany, payInstallment, undoInstallmentPayment } from "@/server/corporate-tax/service";

type Params = { params: Promise<{ fiscalYearId: string; period: string }> };

/**
 * Contabiliza el pago de un modelo 202: (473) HP, retenciones y pagos a cuenta, al debe, y la cuenta
 * del banco al haber, con la fecha del pago. Por defecto, el importe guardado del periodo (céntimos).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { fiscalYearId, period } = await params;
    if (!isInstallmentPeriod(period)) return NextResponse.json({ message: "El periodo debe ser 1P, 2P o 3P." }, { status: 400 });
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payInstallmentSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    return NextResponse.json(await payInstallment({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, fiscalYearId, period, parsed.data));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.installment.pay", "No se pudo contabilizar el pago. Inténtalo de nuevo.");
  }
}

/** Anula el asiento del pago de un modelo 202 con un contraasiento. */
export async function DELETE(_: Request, { params }: Params) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { fiscalYearId, period } = await params;
    if (!isInstallmentPeriod(period)) return NextResponse.json({ message: "El periodo debe ser 1P, 2P o 3P." }, { status: 400 });
    return NextResponse.json(await undoInstallmentPayment({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, fiscalYearId, period));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.installment.unpay", "No se pudo anular el pago. Inténtalo de nuevo.");
  }
}
