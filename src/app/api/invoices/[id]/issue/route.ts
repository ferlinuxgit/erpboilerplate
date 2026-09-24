import { NextResponse } from "next/server";

import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { issueInvoice } from "@/server/invoices/service";

/** Emite un borrador: número definitivo, snapshot fiscal, asiento y auditoría. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.write")) {
    return NextResponse.json({ message: "No tienes permisos para emitir facturas." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const issued = await issueInvoice(toInvoiceActor(actor), id);
    return NextResponse.json({ ...issued, pdfUrl: `/api/invoices/${issued.id}/pdf` });
  } catch (error) {
    return invoiceErrorResponse(error, "invoice.issue", "No se pudo emitir la factura.");
  }
}
