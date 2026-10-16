import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { checkCompanyMailInbox } from "@/server/ocr/mail-inbox";

/** «Comprobar ahora»: importa ya los correos nuevos (si no, el worker lo hace cada pocos minutos). */
export async function POST() {
  try {
    const { ctx } = await requirePermission("expense.write");
    return NextResponse.json(await checkCompanyMailInbox(ctx.company.id));
  } catch (error) {
    return handleRouteError(error, "expense.mailInbox.check", "No se pudo revisar el buzón de facturas.");
  }
}
