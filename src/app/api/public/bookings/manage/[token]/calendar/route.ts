import { NextResponse } from "next/server";

import { jsonError } from "@/lib/http";
import { bookingIcs } from "@/modules/hospitality/bookings";
import { getBookingByToken } from "@/server/pos/bookings";

/** La reserva como evento de calendario (.ics). */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const booking = await getBookingByToken((await params).token);
  if (!booking) return jsonError(404, "Reserva no encontrada.");
  const ics = bookingIcs({
    code: booking.code,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    title: `Reserva en ${booking.restaurant}`,
    description: `${booking.partySize} personas a nombre de ${booking.name}. Localizador ${booking.code}.`,
    location: booking.address,
    now: new Date(),
    cancelled: booking.status === "CANCELLED",
  });
  return new NextResponse(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="reserva-${booking.code}.ics"`, "Cache-Control": "no-store" } });
}
