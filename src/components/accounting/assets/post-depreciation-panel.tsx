"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/format";
import { formatIsoDate } from "@/server/fixed-assets/schedule";
import type { DepreciationRun } from "@/server/fixed-assets/service";

type PostDepreciationPanelProps = {
  canWrite: boolean;
  currencyCode: string;
  /** Lo pendiente hasta la fecha propuesta, calculado en el servidor. */
  initialPreview: DepreciationRun;
  /** Fechas rápidas: fin del mes pasado, hoy, cierre del ejercicio. */
  shortcuts: Array<{ label: string; date: string }>;
};

const frequencyLabels = { monthly: "Mensual (un asiento por bien y mes)", annual: "Anual (un asiento por bien al cierre del ejercicio)" } as const;

/**
 * «Contabilizar amortizaciones hasta <fecha>»: muestra lo pendiente de cada bien y genera los
 * asientos. Repetirlo no duplica nada: los periodos ya contabilizados no vuelven a salir.
 */
export function PostDepreciationPanel({ canWrite, currencyCode, initialPreview, shortcuts }: PostDepreciationPanelProps) {
  const router = useRouter();
  const [until, setUntil] = useState(initialPreview.until);
  const [preview, setPreview] = useState<DepreciationRun | null>(initialPreview);
  const [busy, setBusy] = useState<"preview" | "post" | "settings" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DepreciationRun | null>(null);
  const money = (cents: number) => formatMoney(cents / 100, currencyCode);

  async function loadPreview(date: string) {
    setUntil(date);
    setDone(null);
    setError(null);
    if (!date) {
      setPreview(null);
      return;
    }
    setBusy("preview");
    try {
      const response = await fetch(`/api/fixed-assets/depreciation?until=${encodeURIComponent(date)}`);
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron calcular las amortizaciones pendientes."));
      setPreview(await response.json());
    } catch (caught) {
      setPreview(null);
      setError(errorMessage(caught, "No se pudieron calcular las amortizaciones pendientes."));
    } finally {
      setBusy(null);
    }
  }

  async function changeFrequency(frequency: string) {
    setBusy("settings");
    setError(null);
    try {
      const response = await fetch("/api/fixed-assets/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ depreciationFrequency: frequency }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo cambiar la periodicidad."));
      toast.success("Periodicidad de las amortizaciones guardada.");
      await loadPreview(until);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo cambiar la periodicidad."));
      setBusy(null);
    }
  }

  async function post() {
    setBusy("post");
    setError(null);
    try {
      const response = await fetch("/api/fixed-assets/depreciation", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ until }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudieron contabilizar las amortizaciones."));
      const result: DepreciationRun = await response.json();
      setDone(result);
      setPreview(null);
      if (result.entries > 0) toast.success(`${result.entries} ${result.entries === 1 ? "asiento generado" : "asientos generados"} por ${money(result.amountCents)}.`);
      else toast.info("No había amortizaciones que contabilizar.");
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudieron contabilizar las amortizaciones."));
    } finally {
      setBusy(null);
    }
  }

  const shown = done ?? preview;
  const frequency = shown?.frequency ?? initialPreview.frequency;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[14rem_minmax(0,1fr)_minmax(0,20rem)] md:items-start">
        <AccessibleField helperText="Se contabilizan los periodos terminados hasta esta fecha." id="depreciation-until" label="Contabilizar hasta">
          <Input onChange={(event) => void loadPreview(event.target.value)} type="date" value={until} />
        </AccessibleField>
        <div className="flex flex-wrap gap-1.5 md:pt-6">
          {shortcuts.map((shortcut) => (
            <Button disabled={busy !== null} key={shortcut.label} onClick={() => void loadPreview(shortcut.date)} size="sm" type="button" variant={shortcut.date === until ? "secondary" : "outline"}>
              {shortcut.label}
            </Button>
          ))}
        </div>
        <AccessibleField helperText="Cambiarla no toca lo ya contabilizado." id="depreciation-frequency" label="Periodicidad de las dotaciones">
          <Select disabled={!canWrite || busy !== null} onChange={(event) => void changeFrequency(event.target.value)} value={frequency}>
            <option value="annual">{frequencyLabels.annual}</option>
            <option value="monthly">{frequencyLabels.monthly}</option>
          </Select>
        </AccessibleField>
      </div>

      {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}
      {busy === "preview" ? <p aria-live="polite" className="text-sm text-muted-foreground">Calculando…</p> : null}

      {shown && shown.rows.length === 0 ? (
        <InlineAlert tone={done ? "success" : "neutral"}>
          {done ? "No había nada pendiente: no se ha generado ningún asiento." : `No hay amortizaciones pendientes de contabilizar hasta el ${formatIsoDate(shown.until)}.`}
          {!done && frequency === "annual" ? " Con periodicidad anual la dotación se contabiliza con fecha del último día del ejercicio." : null}
        </InlineAlert>
      ) : null}

      {shown && shown.rows.length > 0 ? (
        <>
          {done ? (
            <InlineAlert tone="success">
              Contabilizado hasta el {formatIsoDate(done.until)}: {done.entries} {done.entries === 1 ? "asiento" : "asientos"} por {money(done.amountCents)}.
            </InlineAlert>
          ) : null}
          {shown.blockedCents > 0 ? (
            <InlineAlert title={done ? "Parte no se ha podido contabilizar" : "Parte no se podrá contabilizar"} tone="warning">
              {money(shown.blockedCents)} caen en fechas que no admiten apuntes (ejercicio cerrado o sin abrir, o periodo con el modelo de IVA presentado). El motivo de cada bien está en la tabla. Si el bien ya estaba amortizado fuera del programa, indícalo en su ficha («ya venía amortizándose»).
            </InlineAlert>
          ) : null}
          <TableContainer>
            <Table className="min-w-[40rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Bien</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Asientos</TableHead>
                  <TableHead className="text-right">{done ? "Contabilizado" : "A contabilizar"}</TableHead>
                  <TableHead className="text-right">Bloqueado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.rows.map((row) => (
                  <TableRow key={row.assetId}>
                    <TableCell>
                      <Link className="font-mono font-semibold text-link hover:underline" href={`/accounting/assets/${row.assetId}`}>{row.code}</Link>
                    </TableCell>
                    <TableCell>
                      {row.description}
                      {row.blockedReason ? <span className="block text-xs text-warning-text">{row.blockedReason}</span> : null}
                    </TableCell>
                    <TableCell className="text-right font-mono">{row.entries}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{row.amountCents > 0 ? money(row.amountCents) : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono">{row.blockedCents > 0 ? money(row.blockedCents) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right font-mono">{shown.entries}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{money(shown.amountCents)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{shown.blockedCents > 0 ? money(shown.blockedCents) : "—"}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        </>
      ) : null}

      {canWrite && preview && !done ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-xs text-muted-foreground">Cada asiento carga la cuenta de gasto (68x) y abona la amortización acumulada (28x) en el diario general. Se puede repetir sin duplicar.</p>
          <Button disabled={busy !== null || preview.entries === 0} onClick={() => void post()} type="button">
            {busy === "post" ? "Contabilizando…" : `Contabilizar amortizaciones hasta el ${formatIsoDate(until)}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
