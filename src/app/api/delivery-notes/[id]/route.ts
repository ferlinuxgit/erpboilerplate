import { NextResponse } from "next/server";

import { requireContext } from "@/lib/current-context";
import { handleRouteError } from "@/lib/http";
import { getDeliveryNotePdfData, withoutLogo } from "@/server/pdf/sales-document-pdf";

/** Detalle del albarán: emisor, cliente y líneas (los mismos datos que su PDF). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext("invoice.read");
    const { id } = await params;
    const data = await getDeliveryNotePdfData(ctx.company.id, id);
    if (!data) return NextResponse.json({ message: "Albarán no encontrado." }, { status: 404 });
    return NextResponse.json(withoutLogo(data.input));
  } catch (error) {
    return handleRouteError(error, "deliveryNote.get");
  }
}
