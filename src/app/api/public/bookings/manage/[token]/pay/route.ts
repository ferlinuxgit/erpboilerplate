import { NextResponse } from "next/server";

import { handleRouteError, jsonError } from "@/lib/http";
import { getBookingByToken } from "@/server/pos/bookings";
import { startDepositPayment } from "@/server/pos/deposits";

/** Volver a intentar el pago de la fianza (si se cerró la página de pago o falló la tarjeta). */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const booking = await getBookingByToken(token);
    if (!booking) return jsonError(404, "Reserva no encontrada.");
    return NextResponse.json(await startDepositPayment(booking.id, token));
  } catch (error) {
    return handleRouteError(error, "public.bookings.pay");
  }
}
