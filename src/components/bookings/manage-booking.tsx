"use client";

import { CalendarPlus, CheckCircle, HourglassMedium, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { bookingStatusLabels, depositStatusLabels, type BookingStatus, type DepositStatus } from "@/modules/hospitality/bookings";

import { goToPayment, type DepositPayment } from "./payment-redirect";

type Booking = { code: string; status: BookingStatus; when: string; partySize: number; name: string; notes: string | null; canCancel: boolean; cancellationHours: number; phone: string | null; slug: string; welcomeMessage: string | null; deposit: { status: DepositStatus; amount: number; refundable: boolean; holdExpiresAt: string | null } | null };

export function ManageBooking({ booking, isNew, payment = null, token }: { booking: Booking; isNew: boolean; payment?: "ok" | "cancelled" | null; token: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = booking.status === "CONFIRMED" || booking.status === "PENDING";
  const awaiting = booking.status === "AWAITING_PAYMENT";
  // Volvió de pagar pero el aviso de la pasarela aún no ha llegado: se recarga sola unos segundos.
  const checking = awaiting && payment === "ok";
  useEffect(() => {
    if (!checking) return;
    const timer = window.setTimeout(() => router.refresh(), 3000);
    return () => window.clearTimeout(timer);
  }, [checking, router]);

  async function pay() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/bookings/manage/${token}/pay`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "No se pudo iniciar el pago.");
        return;
      }
      goToPayment((await response.json()) as DepositPayment);
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/public/bookings/manage/${token}/cancel`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "No se pudo cancelar.");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { refundError?: string | null };
      if (body.refundError) setError(`Reserva cancelada, pero la devolución de la fianza ha fallado: ${body.refundError} Avisa al restaurante.`);
      setConfirming(false);
      router.replace(`/reservar/gestion/${token}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const heading =
    awaiting ? { icon: HourglassMedium, text: checking ? "Comprobando el pago…" : "Falta pagar la fianza", tone: "text-warning-text" }
    : booking.status === "CANCELLED" ? { icon: XCircle, text: "Reserva cancelada", tone: "text-destructive" }
    : booking.status === "PENDING" ? { icon: HourglassMedium, text: isNew ? "¡Solicitud enviada!" : "Pendiente de confirmar", tone: "text-warning-text" }
    : { icon: CheckCircle, text: isNew ? "¡Reserva confirmada!" : `Reserva ${bookingStatusLabels[booking.status].toLowerCase()}`, tone: "text-success-text" };
  const Icon = heading.icon;

  return (
    <div className="space-y-4" data-testid="booking-manage">
      <h1 className={`flex items-center gap-2 font-mono text-xl font-bold ${heading.tone}`} data-testid="booking-manage-status"><Icon aria-hidden="true" className="size-7" weight="fill" />{heading.text}</h1>
      {awaiting && booking.deposit ? (
        <div className="space-y-2 border-2 border-warning bg-warning/10 p-3 text-sm" data-testid="booking-deposit-due">
          <p>{checking ? "Estamos esperando la confirmación del banco. Esto tarda unos segundos." : payment === "cancelled" ? "No se ha completado el pago." : "Tu mesa está guardada mientras pagas la fianza."} Fianza: <strong>{formatMoney(booking.deposit.amount)}</strong>{booking.deposit.holdExpiresAt ? `, hasta las ${new Date(booking.deposit.holdExpiresAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : ""}.</p>
          {!checking ? <Button className="h-12 w-full" data-testid="booking-deposit-pay" disabled={pending} onClick={() => void pay()} type="button">Pagar la fianza</Button> : null}
        </div>
      ) : null}
      {booking.deposit && !awaiting && booking.deposit.status !== "NONE" ? <p className="text-sm" data-testid="booking-deposit-status"><strong>{depositStatusLabels[booking.deposit.status]}</strong>: {formatMoney(booking.deposit.amount)}{booking.deposit.status === "PAID" ? (booking.deposit.refundable ? ` · se devuelve si cancelas hasta ${booking.cancellationHours} h antes` : " · no se devuelve") : ""}</p> : null}
      {isNew && booking.status === "PENDING" ? <p className="text-sm">El restaurante revisará tu solicitud y te escribirá por email en cuanto la confirme.</p> : null}
      {isNew && booking.status === "CONFIRMED" ? <p className="text-sm">Te hemos enviado los detalles por email. Guarda este enlace para consultarla o cancelarla.</p> : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border border-window-dark-shadow bg-window-panel p-3 text-sm">
        <dt className="text-muted-foreground">Localizador</dt>
        <dd className="font-mono text-base font-black tracking-widest" data-testid="booking-code">{booking.code}</dd>
        <dt className="text-muted-foreground">Cuándo</dt>
        <dd className="font-semibold first-letter:uppercase">{booking.when}</dd>
        <dt className="text-muted-foreground">Personas</dt>
        <dd className="font-semibold">{booking.partySize}</dd>
        <dt className="text-muted-foreground">A nombre de</dt>
        <dd className="font-semibold">{booking.name}</dd>
        {booking.notes ? <><dt className="text-muted-foreground">Comentarios</dt><dd>{booking.notes}</dd></> : null}
      </dl>
      {active && booking.welcomeMessage ? <p className="whitespace-pre-line text-sm text-muted-foreground">{booking.welcomeMessage}</p> : null}

      {active ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <a className="inline-flex h-12 items-center justify-center gap-2 border-2 border-window-dark-shadow bg-window-panel px-3 font-mono text-sm font-bold shadow-raised hover:bg-window-highlight" download href={`/api/public/bookings/manage/${token}/calendar`}>
            <CalendarPlus aria-hidden="true" className="size-5" /> Añadir al calendario
          </a>
          {booking.canCancel ? (
            <Button className="h-12" data-testid="booking-cancel" onClick={() => setConfirming(true)} type="button" variant="outline"><XCircle aria-hidden="true" /> Cancelar reserva</Button>
          ) : (
            <p className="text-sm text-muted-foreground">Ya no se puede cancelar online (hasta {booking.cancellationHours} h antes).{booking.phone ? <> Llama al <a className="underline" href={`tel:${booking.phone.replace(/\s/g, "")}`}>{booking.phone}</a>.</> : null}</p>
          )}
        </div>
      ) : null}

      {confirming ? (
        <div className="space-y-2 border-2 border-destructive bg-destructive/10 p-3" role="alertdialog" aria-label="Confirmar cancelación">
          <p className="text-sm font-semibold">¿Seguro que quieres cancelar tu reserva? La mesa quedará libre para otros clientes.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button className="h-12" disabled={pending} onClick={() => setConfirming(false)} type="button" variant="outline">No, mantenerla</Button>
            <Button className="h-12" data-testid="booking-cancel-confirm" disabled={pending} onClick={() => void cancel()} type="button" variant="destructive">{pending ? "Cancelando…" : "Sí, cancelar"}</Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="border-2 border-destructive bg-destructive/10 p-2 text-sm font-semibold text-destructive" role="alert">{error}</p> : null}

      <p className="border-t border-window-shadow pt-3 text-sm"><Link className="underline" href={`/reservar/${booking.slug}`}>Hacer otra reserva</Link></p>
    </div>
  );
}
