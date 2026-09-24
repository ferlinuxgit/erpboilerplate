import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { closeFiscalYear } from "@/server/accounting/fiscal-years";

const payloadSchema = z.object({ fiscalYearId: z.string().trim().min(1).optional() }).nullable();

/**
 * Cierra el ejercicio indicado (o el activo): asiento de regularización (6/7 → 129), asiento de
 * cierre de cuentas de balance y, si el ejercicio siguiente ya existe, su asiento de apertura.
 */
export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) return NextResponse.json({ message: "Sin permisos para cerrar el ejercicio." }, { status: 403 });
  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  try {
    const result = await closeFiscalYear({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: session.user.id,
      fiscalYearId: parsed.data?.fiscalYearId ?? ctx.fiscalYear.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "accounting.close-year", "No se pudo cerrar el ejercicio. Inténtalo de nuevo.");
  }
}
