import { NextResponse } from "next/server";

import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { getInvoicePdfData } from "@/server/pdf/invoice-pdf";
import { renderInvoicePdf } from "@/server/pdf/render";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  const data = await getInvoicePdfData(ctx.company.id, id);
  if (!data) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });

  const pdf = await renderInvoicePdf(data.input);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.filename}"`,
    },
  });
}
