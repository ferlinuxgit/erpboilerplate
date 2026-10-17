import { after, NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { storeInvoicePdfQuietly } from "@/server/invoices/stored-pdf";
import { createSale } from "@/server/pos/service";

import { posActor } from "../actor";
import { firstIssue, saleSchema } from "../schemas";

/** Cobra un ticket: factura emitida, cobros, stock y ticket en la sesión abierta. */
export async function POST(request: Request) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = saleSchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    const sale = await createSale(actor, parsed.data);
    // El PDF del ticket se guarda después de responder: el cajero no espera.
    after(() => storeInvoicePdfQuietly(actor.companyId, sale.invoiceId));
    return NextResponse.json(sale, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.sales.create");
  }
}
