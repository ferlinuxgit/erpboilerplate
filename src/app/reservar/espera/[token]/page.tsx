import type { Metadata } from "next";
import Link from "next/link";

import { PublicBookingShell } from "@/components/bookings/public-shell";
import { WaitlistCancel } from "@/components/bookings/waitlist-cancel";
import { getWaitlistByToken } from "@/server/pos/waitlist";

export const metadata: Metadata = { title: "Lista de espera", robots: { index: false, follow: false } };

/** Enlace del email de la lista de espera: ver la solicitud y salir de la lista. */
export default async function WaitlistPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const entry = await getWaitlistByToken(token);
  return (
    <PublicBookingShell name="Reservas">
      {!entry ? (
        <p className="text-sm">No encontramos esa solicitud. Revisa que has copiado el enlace entero.</p>
      ) : (
        <div className="space-y-3" data-testid="waitlist-manage">
          <h1 className="font-mono text-xl font-bold">Lista de espera</h1>
          <p className="text-sm"><span className="font-semibold first-letter:uppercase">{entry.day}</span> · {entry.partySize} {entry.partySize === 1 ? "persona" : "personas"}{entry.preferredTime ? ` · hacia las ${entry.preferredTime}` : ""} · a nombre de {entry.name}</p>
          {entry.status === "CANCELLED" ? <p className="font-semibold text-muted-foreground" data-testid="waitlist-status">Has salido de la lista de espera.</p> : entry.status === "BOOKED" ? <p className="font-semibold text-success-text" data-testid="waitlist-status">Ya tienes mesa: ¡te esperamos!</p> : (
            <>
              <p className="text-sm" data-testid="waitlist-status">{entry.status === "NOTIFIED" ? "Te hemos avisado de que hay mesa: resérvala cuanto antes." : "Seguimos atentos: si se libera una mesa te escribimos."}</p>
              {entry.slug ? <Link className="inline-flex h-12 items-center border-2 border-primary bg-primary px-4 font-mono font-bold text-primary-foreground" href={`/reservar/${entry.slug}?fecha=${entry.date}&personas=${entry.partySize}`}>Ver horas libres</Link> : null}
              <WaitlistCancel token={token} />
            </>
          )}
        </div>
      )}
    </PublicBookingShell>
  );
}
