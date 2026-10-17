import { after, NextResponse } from "next/server";

import { handleRouteError, invalidJsonResponse, jsonError, readJsonBody } from "@/lib/http";
import { storeInvoicePdfQuietly } from "@/server/invoices/stored-pdf";
import { payOrder } from "@/server/pos/hospitality";

import { posActor } from "../../../../actor";
import { firstIssue, paySchema } from "../../../schemas";

/** Cobra la cuenta entera o una parte (por productos o a partes iguales): un ticket por cobro. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await posActor("pos.sell");
    const payload = await readJsonBody(request);
    if (!payload) return invalidJsonResponse();
    const parsed = paySchema.safeParse(payload);
    if (!parsed.success) return jsonError(400, firstIssue(parsed.error));
    const result = await payOrder(actor, (await params).id, parsed.data);
    after(() => storeInvoicePdfQuietly(actor.companyId, result.invoiceId));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "pos.orders.pay");
  }
}
