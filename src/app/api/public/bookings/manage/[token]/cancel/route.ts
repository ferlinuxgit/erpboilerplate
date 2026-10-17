import { after, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/http";
import { cancelBookingByToken } from "@/server/pos/bookings";

/** El cliente cancela su reserva desde su enlace privado. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { notify, cancelled } = await cancelBookingByToken((await params).token);
    if (notify) after(notify);
    return NextResponse.json({ cancelled });
  } catch (error) {
    return handleRouteError(error, "public.bookings.cancel");
  }
}
