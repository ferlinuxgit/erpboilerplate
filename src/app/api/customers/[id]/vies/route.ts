import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { customer, partner } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError } from "@/lib/http";
import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { checkVatNumber } from "@/server/vies/client";

/**
 * Comprueba el NIF-IVA del cliente en VIES y guarda el resultado en su ficha (estado + fecha).
 * Si VIES no está disponible responde 200 con status UNAVAILABLE: no bloquea al usuario.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "customer.create")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const { id } = await params;
  try {
    const [row] = await db
      .select({ id: customer.id, taxId: partner.taxId, countryCode: partner.countryCode, viesStatus: customer.viesStatus })
      .from(customer)
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id)))
      .limit(1);
    if (!row) return NextResponse.json({ message: "Cliente no encontrado." }, { status: 404 });
    if (!row.taxId) return NextResponse.json({ message: "El cliente no tiene NIF-IVA en su ficha." }, { status: 422 });

    const result = await checkVatNumber(row.countryCode ?? "ES", row.taxId);
    // Un fallo temporal de VIES no sustituye una comprobación anterior (válida o no).
    if (result.status !== "UNAVAILABLE" || !row.viesStatus) {
      await db
        .update(customer)
        .set({ viesStatus: result.status, viesName: result.name, viesCheckedAt: result.checkedAt, updatedAt: new Date() })
        .where(and(eq(customer.id, id), eq(customer.companyId, ctx.company.id)));
    }
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "customer.vies", "No se pudo comprobar el NIF-IVA en VIES.");
  }
}
