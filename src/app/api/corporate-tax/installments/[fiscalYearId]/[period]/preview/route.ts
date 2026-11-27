import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { isInstallmentPeriod } from "@/server/corporate-tax/installments-model";
import { installmentSchema } from "@/server/corporate-tax/schemas";
import { assertCorporateTaxCompany, previewInstallment } from "@/server/corporate-tax/service";

/** Calcula un pago fraccionado con los datos enviados sin guardar nada (vista previa). Importes en céntimos. */
export async function POST(request: Request, { params }: { params: Promise<{ fiscalYearId: string; period: string }> }) {
  try {
    const { ctx } = await requirePermission("fiscal.read");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { fiscalYearId, period } = await params;
    if (!isInstallmentPeriod(period)) return NextResponse.json({ message: "El periodo debe ser 1P, 2P o 3P." }, { status: 400 });
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = installmentSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    return NextResponse.json(await previewInstallment(ctx.company.id, fiscalYearId, period, parsed.data));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.installment.preview", "No se pudo calcular el pago fraccionado.");
  }
}
