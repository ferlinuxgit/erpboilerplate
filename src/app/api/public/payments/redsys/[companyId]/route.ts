import { after, NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { notifyNewBooking } from "@/server/pos/bookings";
import { handleRedsysNotification } from "@/server/pos/deposits";

/** Notificación de Redsys (servidor a servidor): resultado del pago de la fianza, firmado. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  try {
    const { companyId } = await params;
    const form = await request.formData();
    const encoded = String(form.get("Ds_MerchantParameters") ?? "");
    const signature = String(form.get("Ds_Signature") ?? "");
    if (!encoded || !signature) return jsonError(400, "Notificación incompleta.");
    const result = await handleRedsysNotification(companyId, encoded, signature);
    if (result.notify && result.bookingId) after(() => notifyNewBooking(companyId, result.bookingId!));
    return new NextResponse("OK", { headers: { "Content-Type": "text/plain" } });
  } catch (error) {
    return handleRouteError(error, "public.payments.redsys");
  }
}
