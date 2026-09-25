"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { errorMessage, readApiError } from "@/components/ui/form";
import { InlineAlert } from "@/components/ui/page";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatCount } from "@/lib/pluralize";

type Anomaly = { sequence: number | null; code: string; message: string };
type VerifyResult = { ok: boolean; recordCount: number; eventCount: number; anomalies: Anomaly[] };

/** Botones "Verificar integridad", "Enviar ahora" y descargas de la pantalla VERI*FACTU. */
export function VerifactuActions({ canWrite, transportEnabled, pendingCount }: { canWrite: boolean; transportEnabled: boolean; pendingCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"verify" | "send" | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const verify = async () => {
    setBusy("verify");
    try {
      const response = await fetch("/api/verifactu/verify", { method: "POST", headers: { ...getCsrfHeader() } });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo verificar la cadena."));
      const body = (await response.json()) as VerifyResult;
      setResult(body);
      if (body.ok) toast.success(`Cadena íntegra: ${formatCount(body.recordCount, "registro comprobado", "registros comprobados")}.`);
      else toast.error(`Se han detectado ${formatCount(body.anomalies.length, "anomalía")}.`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo completar la operación."));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy("send");
    try {
      const response = await fetch("/api/verifactu/send", { method: "POST", headers: { ...getCsrfHeader() } });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo enviar a la AEAT."));
      const body = (await response.json()) as { summaries?: Array<{ accepted: number; rejected: number; failed: number }> };
      const totals = (body.summaries ?? []).reduce((acc, row) => ({ accepted: acc.accepted + row.accepted, rejected: acc.rejected + row.rejected, failed: acc.failed + row.failed }), { accepted: 0, rejected: 0, failed: 0 });
      toast.success(`Envío terminado: ${formatCount(totals.accepted, "aceptado")}, ${formatCount(totals.rejected, "rechazado")} y ${formatCount(totals.failed, "pendiente")} de reintento.`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo completar la operación."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canWrite ? (
          <Button aria-busy={busy === "verify"} disabled={busy !== null} onClick={verify} type="button">
            {busy === "verify" ? "Verificando…" : "Verificar integridad"}
          </Button>
        ) : null}
        {canWrite && transportEnabled && pendingCount > 0 ? (
          <Button aria-busy={busy === "send"} disabled={busy !== null} onClick={send} type="button" variant="outline">
            {busy === "send" ? "Enviando…" : `Enviar ahora (${pendingCount})`}
          </Button>
        ) : null}
        <a className={buttonVariants({ variant: "outline" })} href="/api/verifactu/export?format=csv">Descargar registros (CSV)</a>
        <a className={buttonVariants({ variant: "outline" })} href="/api/verifactu/export?format=xml">Descargar registros (XML)</a>
      </div>
      {result ? (
        result.ok ? (
          <InlineAlert tone="success" title="Todo correcto">
            Se han recalculado las huellas de {formatCount(result.recordCount, "registro")} y {formatCount(result.eventCount, "evento")}: ninguno ha sido alterado y la cadena no tiene huecos.
          </InlineAlert>
        ) : (
          <InlineAlert tone="danger" title="Se han detectado anomalías">
            <ul className="list-disc pl-4">
              {result.anomalies.slice(0, 10).map((anomaly, index) => <li key={`${anomaly.code}-${index}`}>{anomaly.message}</li>)}
            </ul>
            <p className="mt-1">Queda anotado en el registro de eventos. Contacta con soporte antes de emitir más facturas.</p>
          </InlineAlert>
        )
      ) : null}
    </div>
  );
}
