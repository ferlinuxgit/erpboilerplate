import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody, httpErrorResponse } from "@/lib/http";
import { logger } from "@/lib/logger";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { recordAudit } from "@/server/audit";
import { listCompanyTaxCatalog, setCompanyCatalogTaxInUse } from "@/server/taxes/catalog";

const catalogToggleSchema = z.object({
  code: z.string().trim().min(1, "Indica el impuesto del catálogo.").max(80),
  inUse: z.boolean(),
});

/** Catálogo de impuestos y retenciones del territorio de la empresa, con los que usa marcados. */
export async function GET() {
  try {
    const session = await getUserSession();
    if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
    const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
    return NextResponse.json(await listCompanyTaxCatalog(ctx.company.id));
  } catch (error) {
    return httpErrorResponse(error);
  }
}

/** Marca un impuesto del catálogo como «lo uso» (se crea o se reactiva) o «no lo uso» (se archiva). */
export async function PATCH(request: Request) {
  try {
    const session = await getUserSession();
    if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
    const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
    if (!can(ctx.membership.role, "settings.manage")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = catalogToggleSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Los datos no son válidos." }, { status: 400 });
    try {
      const result = await db.transaction(async (tx) => {
        const updated = await setCompanyCatalogTaxInUse(ctx.company.id, parsed.data.code, parsed.data.inUse, tx);
        if (!updated) return null;
        await recordAudit(
          {
            tenantId: ctx.tenant.id,
            companyId: ctx.company.id,
            actorUserId: session.user.id,
            action: parsed.data.inUse ? "tax.catalog_enable" : "tax.catalog_disable",
            entityName: "tax",
            entityId: "taxId" in updated && updated.taxId ? updated.taxId : parsed.data.code,
            payload: { code: parsed.data.code, name: updated.name, inUse: parsed.data.inUse },
          },
          tx,
        );
        return updated;
      });
      if (!result) return NextResponse.json({ message: "Ese impuesto no está en el catálogo de tu territorio." }, { status: 404 });
      return NextResponse.json(result);
    } catch (error) {
      logger.error({ err: error }, "tax.catalog_toggle_failed");
      return NextResponse.json({ message: "No se pudo guardar el cambio." }, { status: 500 });
    }
  } catch (error) {
    return httpErrorResponse(error);
  }
}
