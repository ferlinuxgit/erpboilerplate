"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { formatScheduleDate } from "@/server/recurring/schedule";

export type PendingExpenseRun = {
  id: string;
  templateName: string;
  supplierName: string;
  periodDate: string;
  message: string | null;
  lines: Array<{ description: string; unitPrice: number }>;
  estimatedTotal: number;
};

function ConfirmRunButton({ run }: { run: PendingExpenseRun }) {
  const router = useRouter();
  const idBase = useId();
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState(() => run.lines.map((line) => line.unitPrice.toFixed(2).replace(".", ",")));
  const [documentNumber, setDocumentNumber] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = amounts.map((value) => parseDecimalInput(value, { maximumFractionDigits: 2 }));
    const nextErrors = parsed.map((value) => (value === null || value < 0 ? "Indica un importe (por ejemplo, 45,30)." : ""));
    setErrors(nextErrors);
    if (nextErrors.some(Boolean)) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/recurring/runs/${run.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({ unitPrices: parsed, supplierDocumentNumber: documentNumber || null }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo registrar el gasto."));
      const created = (await response.json()) as { number: string };
      toast.success(`Gasto registrado (${created.number}).`);
      setOpen(false);
      router.refresh();
    } catch (confirmError) {
      setError(errorMessage(confirmError, "No se pudo registrar el gasto."));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button">Revisar y registrar</Button>
      <Dialog
        description="Ajusta el importe si este periodo ha sido distinto (luz, teléfono…). Al registrar se contabiliza."
        initialFocusId={`${idBase}-amount-0`}
        onClose={() => { if (!pending) setOpen(false); }}
        open={open}
        title={`${run.templateName} · ${formatScheduleDate(run.periodDate)}`}
      >
        <form className="space-y-3" noValidate onSubmit={handleSubmit}>
          {run.lines.map((line, index) => (
            <AccessibleField error={errors[index] || undefined} helperText="Base imponible (sin IVA)." id={`${idBase}-amount-${index}`} key={`${line.description}-${index}`} label={line.description} required>
              <MoneyInput value={amounts[index] ?? ""} onChange={(event) => setAmounts((current) => current.map((value, position) => (position === index ? event.target.value : value)))} />
            </AccessibleField>
          ))}
          <AccessibleField helperText="Opcional: el número que aparece en la factura del proveedor." id={`${idBase}-number`} label="Número de factura del proveedor">
            <Input maxLength={80} value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} />
          </AccessibleField>
          <FormErrorMessage>{error}</FormErrorMessage>
          <DialogFooter>
            <Button disabled={pending} onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
            <SubmitButton pending={pending} pendingLabel="Registrando…">Registrar gasto</SubmitButton>
          </DialogFooter>
        </form>
      </Dialog>
    </>
  );
}

function DiscardRunButton({ run }: { run: PendingExpenseRun }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function discard() {
    setPending(true);
    try {
      const response = await fetch(`/api/recurring/runs/${run.id}`, { method: "DELETE", headers: getCsrfHeader() });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo descartar."));
      toast.success("Periodo descartado: no se registrará este gasto.");
      router.refresh();
    } catch (discardError) {
      toast.error(errorMessage(discardError, "No se pudo descartar."));
    } finally {
      setPending(false);
    }
  }
  return (
    <SubmitButton onClick={() => void discard()} pending={pending} pendingLabel="Descartando…" size="sm" type="button" variant="outline">
      Descartar
    </SubmitButton>
  );
}

/** Gastos recurrentes generados que esperan revisión (modo por defecto). */
export function PendingExpenseRuns({ canEdit, runs }: { runs: PendingExpenseRun[]; canEdit: boolean }) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No hay gastos pendientes de revisar.</p>;
  return (
    <ul className="divide-y border-y" data-testid="pending-expense-runs">
      {runs.map((run) => (
        <li className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm" key={run.id}>
          <span>
            <span className="block font-semibold">{run.templateName} · {formatScheduleDate(run.periodDate)}</span>
            <span className="block text-xs text-muted-foreground">{run.supplierName} · {run.lines.map((line) => line.description).join(", ")}</span>
            {run.message ? <span className="block text-xs text-warning-text">{run.message}</span> : null}
          </span>
          <span className="flex items-center gap-2">
            <span className="font-mono font-semibold">{formatMoney(run.estimatedTotal)}</span>
            {canEdit ? (
              <>
                <ConfirmRunButton run={run} />
                <DiscardRunButton run={run} />
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
