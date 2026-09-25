import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { previewBankImport } from "@/server/treasury/import";

import { readImportForm } from "../form";

/** Vista previa del extracto: formato detectado, primeras filas, mapeo propuesto y filas descartadas. */
export async function POST(request: Request) {
  try {
    const { ctx } = await requirePermission("treasury.write", "Tu rol no permite importar extractos.");
    const form = await readImportForm(request);
    return NextResponse.json(await previewBankImport(ctx.company.id, form));
  } catch (error) {
    return handleRouteError(error, "treasury.import.preview", "No se pudo leer el extracto. Revisa el fichero e inténtalo de nuevo.");
  }
}
