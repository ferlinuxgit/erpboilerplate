import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { commitBankImport } from "@/server/treasury/import";

import { readImportForm } from "./form";

/** Importa el extracto con el mapeo confirmado y devuelve el informe (importados, omitidos y motivos). */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite importar extractos.");
    const form = await readImportForm(request);
    const report = await commitBankImport(
      { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id, activeFiscalYearId: ctx.fiscalYear.id },
      form,
    );
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "treasury.import", "No se pudo importar el extracto. Inténtalo de nuevo.");
  }
}
