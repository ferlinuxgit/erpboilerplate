import { handleRouteError, jsonError } from "@/lib/http";
import { consumeTenantQuota, RATE_LIMIT_RULES } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac-server";
import { recordAudit } from "@/server/audit";
import { streamTenantExport } from "@/server/tenant/export";

export const runtime = "nodejs";

/** Descarga de todos los datos del espacio (ZIP generado al vuelo). También en solo lectura. */
export async function GET() {
  try {
    const { ctx, user } = await requirePermission("settings.manage");
    if (!(await consumeTenantQuota(RATE_LIMIT_RULES.tenantExport, ctx.tenant.id))) {
      return jsonError(429, "Has descargado la exportación completa varias veces hoy. Vuelve a intentarlo mañana.");
    }
    await recordAudit({ tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: user.id, action: "tenant.export", entityName: "tenant", entityId: ctx.tenant.id, payload: {} });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(streamTenantExport(ctx.tenant.id), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="exportacion-${date}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleRouteError(error, "tenant.export", "No se pudo preparar la exportación.");
  }
}
