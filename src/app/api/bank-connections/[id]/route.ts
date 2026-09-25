import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { linkConnectionAccount, revokeBankConnection, startBankConnection, syncBankConnection } from "@/server/bank-connections/service";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("renew") }),
  z.object({ action: z.literal("link"), accountId: z.string().trim().min(1), bankAccountId: z.string().trim().min(1).nullable() }),
]);

/** Sincronizar ahora, renovar el permiso o enlazar una cuenta del banco con una cuenta del ERP. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite gestionar conexiones bancarias.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Acción no válida." }, { status: 400 });
    const { id } = await params;
    const actor = { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id };
    if (parsed.data.action === "sync") return NextResponse.json(await syncBankConnection(actor, id));
    if (parsed.data.action === "renew") return NextResponse.json(await startBankConnection(actor, { institutionId: "", connectionId: id }));
    return NextResponse.json(await linkConnectionAccount(actor, id, parsed.data.accountId, parsed.data.bankAccountId));
  } catch (error) {
    return handleRouteError(error, "bank_connections.update", "No se pudo actualizar la conexión bancaria.");
  }
}

/** Retira el permiso en el proveedor y deja de sincronizar (los movimientos ya importados se quedan). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite gestionar conexiones bancarias.");
    const { id } = await params;
    const revoked = await revokeBankConnection({ companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id }, id);
    if (!revoked) return NextResponse.json({ message: "Conexión no encontrada." }, { status: 404 });
    return NextResponse.json(revoked);
  } catch (error) {
    return handleRouteError(error, "bank_connections.revoke", "No se pudo desconectar el banco.");
  }
}
