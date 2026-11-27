import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { corporateTaxLossSchema } from "@/server/corporate-tax/schemas";
import { assertCorporateTaxCompany, listLossRegister, saveManualLoss } from "@/server/corporate-tax/service";

/** Registro de bases imponibles negativas por ejercicio de origen: importe, lo compensado y lo pendiente (céntimos). */
export async function GET() {
  try {
    const { ctx } = await requirePermission("fiscal.read");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    return NextResponse.json(await listLossRegister(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.losses.list", "No se pudieron cargar las bases negativas.");
  }
}

/** Anota (o corrige) la base negativa pendiente de un ejercicio anterior al uso del programa. Importe en céntimos. */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("fiscal.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = corporateTaxLossSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    return NextResponse.json(await saveManualLoss({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, parsed.data));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.losses.save", "No se pudo guardar la base negativa.");
  }
}
