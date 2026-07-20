import { NextResponse } from "next/server";

import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { getPurchaseOrderPdfData } from "@/server/pdf/purchase-order-pdf";
import { renderPurchaseOrderPdf } from "@/server/pdf/render";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  if (!hasApiActorPermission(actor, "purchase.read")) {
    return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  }

  const { id } = await params;
  const data = await getPurchaseOrderPdfData(actor.context.company.id, id);
  if (!data)
    return NextResponse.json(
      { message: "Pedido no encontrado." },
      { status: 404 },
    );

  const pdf = await renderPurchaseOrderPdf(data.input);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${data.filename}"`,
    },
  });
}
