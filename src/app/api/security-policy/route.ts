import { NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { requirePermission } from "@/lib/rbac-server";
import {
  getTenantSecurityPolicyState,
  updateTenantSecurityPolicy,
} from "@/server/security-policy";

export async function GET() {
  try {
    // Cualquier miembro puede consultar la política; solo OWNER/ADMIN la gestionan.
    const { ctx } = await requirePermission(null);
    const result = await getTenantSecurityPolicyState(ctx.tenant.id);

    return NextResponse.json({
      canManage: can(ctx.membership.role, "settings.manage"),
      policy: result,
    });
  } catch (error) {
    return handleRouteError(error, "securityPolicy.get");
  }
}

export async function PUT(request: Request) {
  try {
    const { ctx, user } = await requirePermission(null);
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();

    // El servicio aplica la autorización por rol (OWNER/ADMIN) y audita el cambio.
    const result = await updateTenantSecurityPolicy({
      actorUserId: user.id,
      role: ctx.membership.role,
      tenantId: ctx.tenant.id,
      companyId: ctx.company.id,
      payload,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error, message: result.error }, { status: result.status });
    }

    return NextResponse.json({ policy: result.policy, changes: result.changes }, { status: result.status });
  } catch (error) {
    return handleRouteError(error, "securityPolicy.update", "No se pudo guardar la política de seguridad.");
  }
}
