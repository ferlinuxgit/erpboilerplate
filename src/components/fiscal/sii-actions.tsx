"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatCount } from "@/lib/pluralize";

type Detection = { created: number; updated: number; cancelled: number; discarded: number; skipped: string | null };
type Summary = { sent: number; accepted: number; acceptedWithErrors: number; rejected: number; failed: number; error?: string | null };

function detectionText(detection: Detection) {
  const changes = detection.created + detection.updated + detection.cancelled + detection.discarded;
  if (changes === 0) return "Todo al día: no hay facturas nuevas, modificadas ni anuladas que comunicar.";
  const parts = [
    detection.created > 0 ? formatCount(detection.created, "comunicación nueva", "comunicaciones nuevas") : null,
    detection.updated > 0 ? formatCount(detection.updated, "actualizada", "actualizadas") : null,
    detection.cancelled > 0 ? formatCount(detection.cancelled, "baja", "bajas") : null,
    detection.discarded > 0 ? formatCount(detection.discarded, "descartada", "descartadas") : null,
  ].filter(Boolean);
  return `Bandeja actualizada: ${parts.join(", ")}.`;
}

/** Botones «Revisar ahora», «Enviar ahora» y descarga de lo suministrado de la pantalla del SII. */
export function SiiActions({ canWrite, transportEnabled, sendableCount }: { canWrite: boolean; transportEnabled: boolean; sendableCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"refresh" | "send" | null>(null);

  const refresh = async () => {
    setBusy("refresh");
    try {
      const response = await fetch("/api/sii/refresh", { method: "POST", headers: { ...getCsrfHeader() } });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron revisar las facturas."));
      const detection = (await response.json()) as Detection;
      if (detection.skipped) toast.info(detection.skipped);
      else toast.success(detectionText(detection));
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudieron revisar las facturas."));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy("send");
    try {
      const response = await fetch("/api/sii/send", { method: "POST", headers: { ...getCsrfHeader() } });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo enviar al SII."));
      const body = (await response.json()) as { message?: string | null; summaries?: Summary[] };
      const totals = (body.summaries ?? []).reduce(
        (acc, row) => ({ sent: acc.sent + row.sent, accepted: acc.accepted + row.accepted + row.acceptedWithErrors, rejected: acc.rejected + row.rejected, failed: acc.failed + row.failed }),
        { sent: 0, accepted: 0, rejected: 0, failed: 0 },
      );
      if (totals.sent === 0) toast.info(body.message ?? "No hay registros que se puedan enviar ahora mismo.");
      else if (totals.failed > 0 || totals.rejected > 0) toast.warning(`Envío terminado: ${formatCount(totals.accepted, "aceptado")}, ${formatCount(totals.rejected, "rechazado")} y ${formatCount(totals.failed, "pendiente")} de reintento.`);
      else toast.success(`Envío terminado: ${formatCount(totals.accepted, "aceptado")}.`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo enviar al SII."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {canWrite ? (
        <Button aria-busy={busy === "refresh"} disabled={busy !== null} onClick={refresh} type="button">
          {busy === "refresh" ? "Revisando…" : "Revisar facturas ahora"}
        </Button>
      ) : null}
      {canWrite && transportEnabled ? (
        <Button aria-busy={busy === "send"} disabled={busy !== null} onClick={send} type="button" variant="outline">
          {busy === "send" ? "Enviando…" : sendableCount > 0 ? `Enviar ahora (${sendableCount})` : "Revisar y enviar ahora"}
        </Button>
      ) : null}
      <a className={buttonVariants({ variant: "outline" })} href="/api/sii/export">Descargar lo suministrado (CSV)</a>
    </div>
  );
}

/** «Reenviar» un registro rechazado, aceptado con errores o sin confirmar; o adelantar un reintento. */
export function SiiResendButton({ recordId, invoiceNumber, label = "Reenviar" }: { recordId: string; invoiceNumber: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/sii/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ recordId }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo reenviar el registro."));
      const body = (await response.json()) as { operation: string; requeued: boolean };
      toast.success(body.requeued
        ? `${invoiceNumber} vuelve a estar lista para el próximo envío.`
        : `${invoiceNumber} vuelve a la bandeja como ${body.operation === "A1" ? "modificación" : body.operation === "BAJA" ? "baja" : "alta"}: saldrá con el próximo envío.`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo reenviar el registro."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button aria-busy={busy} aria-label={`${label} el registro de la factura ${invoiceNumber}`} disabled={busy} onClick={resend} size="sm" type="button" variant="outline">
      {busy ? "Un momento…" : label}
    </Button>
  );
}

/** Fecha desde la que se suministran las facturas. */
export function SiiSinceForm({ since }: { since: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(since ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/sii/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ since: value }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo guardar la fecha de inicio."));
      toast.success("Fecha de inicio guardada. Pulsa «Revisar facturas ahora» para actualizar la bandeja.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo guardar la fecha de inicio."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={save}>
      <label className="grid gap-1 text-sm" htmlFor="sii-since">
        <span className="font-semibold">Suministrar las facturas desde</span>
        <input className="h-9 border border-input bg-background px-2 font-mono text-sm" id="sii-since" onChange={(event) => setValue(event.target.value)} required type="date" value={value} />
      </label>
      <Button aria-busy={busy} disabled={busy || !value || value === since} type="submit" variant="outline">
        {busy ? "Guardando…" : "Guardar fecha"}
      </Button>
    </form>
  );
}
