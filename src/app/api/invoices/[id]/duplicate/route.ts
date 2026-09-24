import { NextResponse } from "next/server";

import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { invoiceErrorResponse, toInvoiceActor } from "@/server/invoices/http";
import { duplicateInvoice } from "@/server/invoices/service";

/** Duplica la factura como un borrador nuevo con fecha de hoy (útil para facturas recurrentes). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.create")) {
    return NextResponse.json({ message: "No tienes permisos para crear facturas." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const created = await duplicateInvoice(toInvoiceActor(actor), id);
    if (!created) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return invoiceErrorResponse(error, "invoice.duplicate", "No se pudo duplicar la factura.");
  }
}
