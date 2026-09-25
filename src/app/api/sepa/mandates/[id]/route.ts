import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { revokeCustomerMandate } from "@/server/sepa/mandates";

const actionSchema = z.object({ action: z.literal("revoke"), customerId: z.string().trim().min(1) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("customer.create", "Tu rol no permite gestionar clientes.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Acción no válida." }, { status: 400 });
    const { id } = await params;
    const revoked = await revokeCustomerMandate({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id }, parsed.data.customerId, id);
    if (!revoked) return NextResponse.json({ message: "Mandato no encontrado o ya revocado." }, { status: 404 });
    return NextResponse.json(revoked);
  } catch (error) {
    return handleRouteError(error, "sepa.mandates.revoke", "No se pudo revocar el mandato.");
  }
}
