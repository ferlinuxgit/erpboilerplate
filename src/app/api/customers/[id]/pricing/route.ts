import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac-server";
import { getCustomerPricing } from "@/server/pricing/service";

/** Tarifa y descuento de grupo del cliente, para calcular los precios de las líneas de venta. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { ctx } = await requirePermission("customer.read");
    const { id } = await params;
    return NextResponse.json(await getCustomerPricing(ctx.company.id, id));
  } catch (error) {
    return handleRouteError(error, "customers.pricing", "No se pudieron cargar los precios del cliente.");
  }
}
