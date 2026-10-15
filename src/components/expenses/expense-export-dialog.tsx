"use client";

import { DownloadSimple } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const FAILURE = "No se pudo generar la exportación de facturas.";

type Period = { label: string; from: string; to: string };

const pad = (value: number) => String(value).padStart(2, "0");
const day = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Periodos habituales del asesor: trimestre actual y anterior, mes anterior y año en curso. */
export function quickExportPeriods(today: Date): Period[] {
  const year = today.getFullYear();
  const quarter = Math.floor(today.getMonth() / 3);
  const quarterPeriod = (y: number, q: number): Period => ({
    label: `${q + 1}T ${y}`,
    from: day(new Date(y, q * 3, 1)),
    to: day(new Date(y, q * 3 + 3, 0)),
  });
  const previousQuarter = quarter === 0 ? quarterPeriod(year - 1, 3) : quarterPeriod(year, quarter - 1);
  const previousMonthStart = new Date(year, today.getMonth() - 1, 1);
  return [
    { ...previousQuarter, label: `Trimestre anterior (${previousQuarter.label})` },
    { ...quarterPeriod(year, quarter), label: `Trimestre actual (${quarter + 1}T ${year})` },
    {
      label: "Mes anterior",
      from: day(previousMonthStart),
      to: day(new Date(previousMonthStart.getFullYear(), previousMonthStart.getMonth() + 1, 0)),
    },
    { label: `Año ${year}`, from: `${year}-01-01`, to: `${year}-12-31` },
  ];
}

/**
 * Exportación para el asesor desde el listado de facturas de proveedor: Excel con todas las columnas
 * o ZIP con el Excel y los documentos originales nombrados por número de registro.
 */
export function ExpenseExportDialog({ defaultFrom, defaultTo, q, status }: { defaultFrom: string | null; defaultTo: string | null; q: string; status: string | null }) {
  const idBase = useId();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultFrom ?? "");
  const [to, setTo] = useState(defaultTo ?? "");
  const [includeDocuments, setIncludeDocuments] = useState(true);
  const [keepFilters, setKeepFilters] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasListFilters = Boolean(q || status);

  async function download() {
    if (from && to && to < from) {
      setError("La fecha final no puede ser anterior a la inicial.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (keepFilters && q) params.set("q", q);
      if (keepFilters && status) params.set("status", status);
      if (includeDocuments) params.set("documents", "1");
      const response = await fetch(`/api/expenses/export?${params.toString()}`);
      if (!response.ok) throw new Error(await readApiError(response, FAILURE));
      const fileName = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? (includeDocuments ? "facturas-recibidas.zip" : "facturas-recibidas.xlsx");
      const missing = Number(response.headers.get("X-Missing-Documents") ?? 0);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
      toast.success(
        includeDocuments && missing > 0
          ? `Exportación descargada. ${missing} ${missing === 1 ? "factura no tiene" : "facturas no tienen"} documento: se listan en LEEME.txt.`
          : "Exportación descargada.",
      );
    } catch (downloadError) {
      const message = errorMessage(downloadError, FAILURE);
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button data-testid="expense-export-open" onClick={() => { setError(null); setOpen(true); }} type="button" variant="outline">
        <DownloadSimple aria-hidden="true" />
        Exportar para el asesor
      </Button>
      <Dialog
        description="Excel con una fila por factura y su desglose por cuenta y tipo de IVA. Las facturas anuladas no se incluyen."
        onClose={() => { if (!pending) setOpen(false); }}
        open={open}
        title="Exportar facturas recibidas"
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Periodos habituales">
            {quickExportPeriods(new Date()).map((period) => (
              <Button
                aria-pressed={from === period.from && to === period.to}
                key={period.label}
                onClick={() => { setFrom(period.from); setTo(period.to); }}
                size="sm"
                type="button"
                variant={from === period.from && to === period.to ? "secondary" : "outline"}
              >
                {period.label}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <AccessibleField helperText="Fecha de la factura." id={`${idBase}-from`} label="Desde">
              <Input data-testid="expense-export-from" onChange={(event) => setFrom(event.target.value)} type="date" value={from} />
            </AccessibleField>
            <AccessibleField id={`${idBase}-to`} label="Hasta">
              <Input data-testid="expense-export-to" min={from || undefined} onChange={(event) => setTo(event.target.value)} type="date" value={to} />
            </AccessibleField>
          </div>
          <label className="flex items-start gap-2 text-sm" htmlFor={`${idBase}-documents`}>
            <input checked={includeDocuments} data-testid="expense-export-documents" id={`${idBase}-documents`} onChange={(event) => setIncludeDocuments(event.target.checked)} type="checkbox" />
            <span>
              <span className="block font-medium">Incluir los PDF de las facturas (ZIP)</span>
              <span className="text-xs text-muted-foreground">Cada documento se nombra con el nº de registro, el proveedor y su nº de factura, y el Excel lo enlaza.</span>
            </span>
          </label>
          {hasListFilters ? (
            <label className="flex items-start gap-2 text-sm" htmlFor={`${idBase}-filters`}>
              <input checked={keepFilters} id={`${idBase}-filters`} onChange={(event) => setKeepFilters(event.target.checked)} type="checkbox" />
              <span>Aplicar también la búsqueda y el estado del listado</span>
            </label>
          ) : null}
          <FormErrorMessage>{error}</FormErrorMessage>
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
          <SubmitButton data-testid="expense-export-submit" onClick={() => void download()} pending={pending} pendingLabel="Preparando…" type="button">
            {includeDocuments ? "Descargar ZIP" : "Descargar Excel"}
          </SubmitButton>
        </DialogFooter>
      </Dialog>
    </>
  );
}
