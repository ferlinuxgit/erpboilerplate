import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { assertCorporateTaxCompany, postCorporateTaxEntry, unpostCorporateTaxEntry } from "@/server/corporate-tax/service";

type Params = { params: Promise<{ fiscalYearId: string }> };

/**
 * Contabiliza el Impuesto sobre Sociedades del ejercicio con fecha de su último día: (6300) al debe;
 * (473) y (4752) al haber, o (4709) al debe si sale a devolver; impuesto diferido (6301, 4740, 479)
 * solo si hay diferencias temporarias. Si ya había asiento, lo anula y genera el nuevo.
 */
export async function POST(_: Request, { params }: Params) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { fiscalYearId } = await params;
    return NextResponse.json(await postCorporateTaxEntry({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, fiscalYearId));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.entry.post", "No se pudo contabilizar el impuesto. Inténtalo de nuevo.");
  }
}

/** Anula el asiento del Impuesto sobre Sociedades del ejercicio con un contraasiento. */
export async function DELETE(_: Request, { params }: Params) {
  try {
    const { ctx, user } = await requirePermission("accounting.write");
    await assertCorporateTaxCompany(ctx.company.id, ctx.company.countryCode);
    const { fiscalYearId } = await params;
    return NextResponse.json(await unpostCorporateTaxEntry({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id }, fiscalYearId));
  } catch (error) {
    return handleRouteError(error, "corporate-tax.entry.reverse", "No se pudo anular el asiento del impuesto. Inténtalo de nuevo.");
  }
}
