import type { Metadata } from "next";

import { BookingForm } from "@/components/bookings/booking-form";
import { PublicBookingShell } from "@/components/bookings/public-shell";
import { getPublicBookingPage } from "@/server/pos/bookings";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ embed?: string; fecha?: string; personas?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getPublicBookingPage((await params).slug);
  return { title: page ? `Reservar mesa · ${page.name}` : "Reservas", description: page ? `Reserva tu mesa en ${page.name} en unos segundos.` : undefined };
}

/** Formulario público de reservas (sin cuenta). */
export default async function PublicBookingPage({ params, searchParams }: Props) {
  const [{ slug }, { embed, fecha, personas }] = await Promise.all([params, searchParams]);
  const page = await getPublicBookingPage(slug);
  if (!page) {
    return (
      <PublicBookingShell embed={embed === "1"} name="Reservas">
        <h1 className="font-mono text-lg font-bold">Reservas no disponibles</h1>
        <p className="mt-2 text-sm text-muted-foreground">Este restaurante no acepta reservas online ahora mismo. Llámalos directamente para reservar.</p>
      </PublicBookingShell>
    );
  }
  return (
    <PublicBookingShell address={page.address} embed={embed === "1"} logo={page.logo} name={page.name} phone={page.phone}>
      <BookingForm embed={embed === "1"} initialDate={fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null} initialParty={personas ? Number(personas) || null : null} page={{ slug: page.slug, name: page.name, phone: page.phone, welcomeMessage: page.welcomeMessage, minPartySize: page.minPartySize, maxPartySize: page.maxPartySize, autoConfirm: page.autoConfirm, cancellationHours: page.cancellationHours, today: page.today, lastDay: page.lastDay, openWeekdays: page.openWeekdays, closures: page.closures }} />
    </PublicBookingShell>
  );
}
