import { NextResponse } from "next/server";
import { z } from "zod";

import { handleRouteError, invalidJsonResponse, isHttpError, readJsonBody } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { undoReconciliation } from "@/server/treasury/workbench";

const payloadSchema = z.object({ transactionIds: z.array(z.string().trim().min(1)).min(1).max(200) });

/** Deshace la conciliación de uno o varios movimientos (cada uno en su propia transacción). */
export async function POST(request: Request) {
  try {
    const { ctx, user } = await requirePermission("treasury.write", "Tu rol no permite conciliar movimientos.");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) return NextResponse.json({ message: "Indica los movimientos a deshacer." }, { status: 400 });
    const actor = { companyId: ctx.company.id, tenantId: ctx.tenant.id, actorUserId: user.id };
    const undone: string[] = [];
    const failed: Array<{ transactionId: string; reason: string }> = [];
    for (const transactionId of parsed.data.transactionIds) {
      try {
        await undoReconciliation(actor, transactionId);
        undone.push(transactionId);
      } catch (error) {
        if (!isHttpError(error)) throw error;
        failed.push({ transactionId, reason: error.message });
      }
    }
    if (undone.length === 0 && failed.length > 0) return NextResponse.json({ message: failed[0].reason, undone, failed }, { status: 409 });
    return NextResponse.json({ undone, failed });
  } catch (error) {
    return handleRouteError(error, "treasury.reconciliation.undo", "No se pudo deshacer la conciliación. Inténtalo de nuevo.");
  }
}
