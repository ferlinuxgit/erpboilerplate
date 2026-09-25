import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { customer, partner } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { recordAudit } from "@/server/audit";

/** Marca un cliente como Inactivo (alternativa a eliminar un cliente con documentos). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "customer.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(customer)
        .set({ status: "INACTIVE", updatedAt: new Date() })
        .where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id)))
        .returning({ id: customer.id, name: customer.name, partnerId: customer.partnerId });
      if (!row) return null;
      if (row.partnerId) {
        await tx.update(partner).set({ isActive: false, updatedAt: new Date() }).where(and(eq(partner.id, row.partnerId), eq(partner.companyId, ctx.company.id)));
      }
      await recordAudit(
        { tenantId: ctx.tenant.id, companyId: ctx.company.id, actorUserId: actor.actorUserId, action: "customer.update", entityName: "customer", entityId: id, payload: { status: "INACTIVE" } },
        tx,
      );
      return row;
    });
    if (!updated) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true, id: updated.id, name: updated.name, status: "INACTIVE" });
  } catch (error) {
    return handleRouteError(error, "customer.deactivate", "No se pudo marcar el cliente como inactivo.");
  }
}
