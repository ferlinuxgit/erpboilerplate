import type { Metadata } from "next";

import { ManageBooking } from "@/components/bookings/manage-booking";
import { PublicBookingShell } from "@/components/bookings/public-shell";
import { getBookingByToken } from "@/server/pos/bookings";

export const metadata: Metadata = { title: "Tu reserva", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ nueva?: string; embed?: string; pago?: string }> };

/** Enlace privado del cliente: ver su reserva, añadirla al calendario o cancelarla. */
export default async function ManageBookingPage({ params, searchParams }: Props) {
  const [{ token }, { nueva, embed, pago }] = await Promise.all([params, searchParams]);
  // Vuelve de la pasarela: se comprueba el pago por si su aviso aún no ha llegado.
  const booking = await getBookingByToken(token, { syncPayment: pago === "ok" });
  if (!booking) {
    return (
      <PublicBookingShell embed={embed === "1"} name="Reservas">
        <h1 className="font-mono text-lg font-bold">Reserva no encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">El enlace no es válido. Revisa que lo has copiado entero desde el email.</p>
      </PublicBookingShell>
    );
  }
  return (
    <PublicBookingShell address={booking.address} embed={embed === "1"} name={booking.restaurant} phone={booking.phone}>
      <ManageBooking
        booking={{ code: booking.code, status: booking.status, when: booking.when, partySize: booking.partySize, name: booking.name, notes: booking.notes, canCancel: booking.canCancel, cancellationHours: booking.cancellationHours, phone: booking.phone, slug: booking.slug, welcomeMessage: booking.welcomeMessage, deposit: booking.deposit }}
        isNew={nueva === "1" || pago === "ok"}
        payment={pago === "ok" ? "ok" : pago === "cancelado" ? "cancelled" : null}
        token={token}
      />
    </PublicBookingShell>
  );
}
