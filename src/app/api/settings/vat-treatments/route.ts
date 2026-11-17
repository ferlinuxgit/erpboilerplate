import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { getCompanySalesVatTreatments, saveCompanySalesVatTreatments } from "@/server/invoices/vat-treatments";
import { isSalesVatTreatmentCode } from "@/server/invoices/vat-treatments-model";

const vatTreatmentsSchema = z.object({
  /** Los que usa la empresa; null vuelve a los automáticos (según lo que vende). */
  treatments: z.array(z.string().refine(isSalesVatTreatmentCode, "Tratamiento de IVA no válido.")).max(10).nullable(),
});

/** Tratamientos de IVA que la empresa usa en sus ventas (los demás no se ofrecen al facturar). */
export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  return NextResponse.json(await getCompanySalesVatTreatments(ctx.company.id));
}

/** Guarda los tratamientos de IVA que usa la empresa. */
export async function PUT(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();
  const parsed = vatTreatmentsSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Los datos no son válidos." }, { status: 400 });
  try {
    const result = await db.transaction(async (tx) => {
      const saved = await saveCompanySalesVatTreatments(ctx.company.id, parsed.data.treatments, tx);
      await recordAudit(
        {
          tenantId: ctx.tenant.id,
          companyId: ctx.company.id,
          actorUserId: session.user.id,
          action: "settings.vat_treatments",
          entityName: "company_settings",
          entityId: ctx.company.id,
          payload: { treatments: saved.enabled, automatic: saved.automatic },
        },
        tx,
      );
      return saved;
    });
    return NextResponse.json(result);
  } catch (error) {
    logger.error({ err: error }, "settings.vat_treatments_failed");
    return NextResponse.json({ message: "No se pudo guardar el cambio." }, { status: 500 });
  }
}
