import { NextResponse } from "next/server";

import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { renderInvoicePdf } from "@/server/pdf/render";
import { getDeliveryNotePdfData } from "@/server/pdf/sales-document-pdf";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  const data = await getDeliveryNotePdfData(actor.context.company.id, (await params).id);
  if (!data) return NextResponse.json({ message: "Albarán no encontrado." }, { status: 404 });
  const pdf = await renderInvoicePdf(data.input);
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${data.filename}"` } });
}
