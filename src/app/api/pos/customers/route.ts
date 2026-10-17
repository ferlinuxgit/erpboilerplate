import { and, asc, eq, ilike, or } from "drizzle-orm";
import { NextResponse } from "next/server";

import { customer, partner } from "@/db/schema";
import { db } from "@/lib/db";
import { handleRouteError } from "@/lib/http";
import { GENERIC_CUSTOMER_NAME } from "@/server/pos/service";

import { posActor } from "../actor";

/** Clientes para hacer factura completa desde el TPV (nombre o NIF). */
export async function GET(request: Request) {
  try {
    const { ctx } = await posActor("pos.sell");
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) return NextResponse.json([]);
    const pattern = `%${query.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
    const rows = await db
      .select({ id: customer.id, name: customer.name, taxId: partner.taxId })
      .from(customer)
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(and(eq(customer.companyId, ctx.company.id), eq(customer.status, "ACTIVE"), or(ilike(customer.name, pattern), ilike(partner.taxId, pattern))))
      .orderBy(asc(customer.name))
      .limit(15);
    return NextResponse.json(rows.filter((row) => row.name !== GENERIC_CUSTOMER_NAME));
  } catch (error) {
    return handleRouteError(error, "pos.customers.search");
  }
}
