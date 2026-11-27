import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { corporateTaxReturnSchema } from "@/server/corporate-tax/schemas";
import { assertCorporateTaxCompany, previewCorporateTaxYear } from "@/server/corporate-tax/service";

/** Calcula la liquidación con los datos enviados sin guardar nada (vista previa del asistente). Importes en céntimos. */
export async function POST(request: Request, { params }: { params: Promise<{ fiscalYearId: string }> }) {
  try {
    const { ctx } = await requirePermission("fiscal.read");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = corporateTaxReturnSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    const { fiscalYearId } = await params;
    return NextResponse.json(await previewCorporateTaxYear(ctx.company.id, fiscalYearId, parsed.data));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.return.preview", "No se pudo calcular la liquidación.");
  }
}
