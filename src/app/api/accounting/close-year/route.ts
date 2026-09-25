import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { handleRouteError, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { getCloseChecklist } from "@/server/accounting/close-checklist";
import { closeChecklistBlocker } from "@/server/accounting/close-checklist-model";
import { closeFiscalYear } from "@/server/accounting/fiscal-years";

const payloadSchema = z
  .object({
    fiscalYearId: z.string().trim().min(1).optional(),
    /** Motivo para cerrar con comprobaciones pendientes (queda en la auditoría). */
    overrideReason: z.string().trim().max(500).optional(),
  })
  .nullable();

/**
 * Cierra el ejercicio indicado (o el activo): asiento de regularización (6/7 → 129), asiento de
 * cierre de cuentas de balance y, si el ejercicio siguiente ya existe, su asiento de apertura.
 * Antes revisa la lista de comprobaciones: un descuadre impide cerrar y los avisos pendientes
 * (303, borradores, 555) exigen un motivo, que se audita.
 */
export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "accounting.write")) return NextResponse.json({ message: "Sin permisos para cerrar el ejercicio." }, { status: 403 });
  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });
  const fiscalYearId = parsed.data?.fiscalYearId ?? ctx.fiscalYear.id;
  const overrideReason = parsed.data?.overrideReason?.trim() || null;

  try {
    const checklist = await getCloseChecklist(ctx.company.id, fiscalYearId);
    const blocker = closeChecklistBlocker(checklist, overrideReason);
    if (blocker) {
      return NextResponse.json({ message: blocker, checklist }, { status: checklist.blocked ? 422 : 409 });
    }
    const result = await closeFiscalYear({
      companyId: ctx.company.id,
      tenantId: ctx.tenant.id,
      actorUserId: session.user.id,
      fiscalYearId,
    });
    if (checklist.requiresOverride && !result.alreadyClosed) {
      await recordAudit({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        action: "accounting.fiscalYear.closeOverride",
        entityName: "fiscalYear",
        entityId: fiscalYearId,
        payload: {
          reason: overrideReason,
          pending: checklist.items.filter((item) => item.status === "pending").map((item) => ({ id: item.id, detail: item.detail })),
        },
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "accounting.close-year", "No se pudo cerrar el ejercicio. Inténtalo de nuevo.");
  }
}
