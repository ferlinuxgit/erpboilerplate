import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { getCloseChecklist } from "@/server/accounting/close-checklist";

type RouteContext = { params: Promise<{ id: string }> };

/** Comprobaciones previas al cierre del ejercicio (303 del último periodo, borradores, 555, descuadre…). */
export async function GET(_: Request, { params }: RouteContext) {
  try {
    const { ctx } = await requirePermission("accounting.read", "Sin permisos de contabilidad.");
    const { id } = await params;
    return NextResponse.json(await getCloseChecklist(ctx.company.id, id));
  } catch (error) {
    return handleRouteError(error, "accounting.close-checklist", "No se pudieron revisar las comprobaciones del cierre.");
  }
}
