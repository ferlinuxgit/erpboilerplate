import { NextResponse } from "next/server";

import { authenticateApiActor, hasApiActorPermission, isAuthError } from "@/lib/integration-auth";
import { getInvoicePdf } from "@/server/invoices/stored-pdf";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await authenticateApiActor(request);
  if (isAuthError(actor)) return actor;
  const ctx = actor.context;
  if (!hasApiActorPermission(actor, "invoice.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const { id } = await params;
  // Emitidas: la copia guardada al emitir (con su número definitivo). Borradores: generado al vuelo.
  const pdf = await getInvoicePdf(ctx.company.id, id);
  if (!pdf) return NextResponse.json({ message: "Factura no encontrada." }, { status: 404 });

  return new NextResponse(new Uint8Array(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
