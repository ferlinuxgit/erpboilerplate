"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { IssueConfirmDialog } from "@/components/invoices/invoice-lifecycle-actions";
import { Button } from "@/components/ui/button";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput, QuantityInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { calculateInvoiceTotals, type InvoiceCalculationTax } from "@/lib/invoice-totals";
import {
  RECTIFICATION_REASONS,
  rectificationReasonLabels,
  rectificationTypeLabels,
  type RectificationReason,
  type RectificationType,
} from "@/server/invoices/lifecycle";

export type CreditNoteSourceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  retentionRate: number;
  /** Impuestos congelados de la línea original (para el cálculo y para reenviar sus ids). */
  taxes: Array<InvoiceCalculationTax & { id: string | null }>;
};

type EditableLine = CreditNoteSourceLine & { key: string; quantityInput: string; unitPriceInput: string };

type Scope = "FULL" | "PARTIAL";

function toEditable(lines: CreditNoteSourceLine[]): EditableLine[] {
  return lines.map((line, index) => ({
    ...line,
    key: `line-${index}`,
    quantityInput: String(line.quantity).replace(".", ","),
    unitPriceInput: line.unitPrice.toFixed(2).replace(".", ","),
  }));
}

function lineTaxLabel(line: CreditNoteSourceLine) {
  if (line.taxes.length > 0) return line.taxes.map((selectedTax) => `${selectedTax.operation === "SUBTRACT" ? "−" : "+"}${selectedTax.name ?? "Impuesto"}`).join(" ");
  const parts = [line.taxRate > 0 ? `IVA ${line.taxRate}%` : null, line.retentionRate > 0 ? `−Ret. ${line.retentionRate}%` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Sin impuestos";
}

/**
 * Formulario de factura rectificativa pensado para no expertos:
 * 1) ¿Qué quieres hacer? (anular entera / abonar una parte) → 2) causa legal → 3) motivo.
 * Los usuarios avanzados pueden elegir rectificación por sustitución y guardar como borrador.
 */
export type CreditNoteDraftValues = {
  creditNoteId: string;
  reason: RectificationReason;
  type: RectificationType;
  scope: Scope;
  description: string;
  /** Líneas del borrador (en positivo) cuando abona una parte o sustituye. */
  lines: CreditNoteSourceLine[];
};

export function CreditNoteForm({
  currencyCode,
  defaultIssueDate,
  draft,
  invoiceId,
  invoiceNumber,
  lines,
  pendingToRectify,
}: {
  invoiceId: string;
  invoiceNumber: string;
  currencyCode: string;
  defaultIssueDate: string;
  lines: CreditNoteSourceLine[];
  /** Importe que aún se puede rectificar (total original menos rectificativas anteriores). */
  pendingToRectify: number;
  /** Edición de un borrador de rectificativa existente. */
  draft?: CreditNoteDraftValues;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>(draft?.scope ?? "FULL");
  const [type, setType] = useState<RectificationType>(draft?.type ?? "DIFFERENCES");
  const [reason, setReason] = useState<RectificationReason>(draft?.reason ?? "R4");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [issueDate, setIssueDate] = useState(defaultIssueDate);
  const [editableLines, setEditableLines] = useState<EditableLine[]>(() => toEditable(draft && draft.lines.length > 0 ? draft.lines : lines));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"issue" | "draft" | null>(null);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);

  const usesLines = scope === "PARTIAL" || type === "SUBSTITUTION";
  const parsedLines = editableLines.map((line) => ({
    ...line,
    quantity: parseDecimalInput(line.quantityInput, { maximumFractionDigits: 3 }) ?? 0,
    unitPrice: parseDecimalInput(line.unitPriceInput, { maximumFractionDigits: 2 }) ?? 0,
  }));

  // Sin impuestos detallados (facturas antiguas) se usan el tipo de IVA y la retención de la línea.
  const forCalculation = (line: CreditNoteSourceLine) => ({ ...line, taxes: line.taxes.length > 0 ? line.taxes : undefined });
  const negate = (items: CreditNoteSourceLine[]) => items.map((line) => ({ ...forCalculation(line), quantity: -line.quantity }));
  // Misma construcción que el servidor: sustitución = original en negativo + líneas correctas.
  const preview = calculateInvoiceTotals(
    type === "SUBSTITUTION" ? [...negate(lines), ...parsedLines.map(forCalculation)] : scope === "FULL" ? negate(lines) : negate(parsedLines),
    { allowNegative: true },
  );

  const exceedsPending = preview.totalAmount < 0 && -preview.totalAmount > pendingToRectify + 0.001;

  function updateLine(key: string, patch: Partial<EditableLine>) {
    setEditableLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function validate() {
    if (description.trim().length < 3) {
      setError("Explica brevemente el motivo de la rectificación (aparecerá en la factura).");
      document.getElementById("credit-note-description")?.focus();
      return false;
    }
    if (usesLines && parsedLines.length === 0) {
      setError("Deja al menos una línea.");
      return false;
    }
    if (exceedsPending) {
      setError(`El abono supera lo que queda por rectificar de ${invoiceNumber} (${formatMoney(pendingToRectify, currencyCode)}).`);
      return false;
    }
    return true;
  }

  async function submit(mode: "issue" | "draft") {
    setError(null);
    if (description.trim().length < 3) {
      setError("Explica brevemente el motivo de la rectificación (aparecerá en la factura).");
      document.getElementById("credit-note-description")?.focus();
      return;
    }
    if (usesLines && parsedLines.length === 0) {
      setError("Deja al menos una línea.");
      return;
    }
    if (exceedsPending) {
      setError(`El abono supera lo que queda por rectificar de ${invoiceNumber} (${formatMoney(pendingToRectify, currencyCode)}).`);
      return;
    }
    setPending(mode);
    try {
      const response = await fetch(draft ? `/api/invoices/${draft.creditNoteId}/credit-note` : `/api/invoices/${invoiceId}/credit-notes`, {
        method: draft ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          reason,
          type,
          scope: type === "SUBSTITUTION" ? "FULL" : scope,
          description: description.trim(),
          issueDate,
          issue: mode === "issue",
          ...(usesLines
            ? {
                lines: parsedLines
                  .filter((line) => line.quantity > 0)
                  .map((line) => ({
                    description: line.description,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                    discountPct: line.discountPct,
                    ...(line.taxes.length > 0 && line.taxes.every((selectedTax) => selectedTax.id)
                      ? { taxIds: line.taxes.map((selectedTax) => selectedTax.id!) }
                      : { taxRate: line.taxRate, retentionRate: line.retentionRate }),
                  })),
              }
            : {}),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo crear la factura rectificativa."));
      const created = (await response.json()) as { id: string; number: string };
      setIssueDialogOpen(false);
      toast.success(mode === "issue" ? `Rectificativa ${created.number} emitida correctamente.` : "Borrador de rectificativa guardado. Puedes seguir editándolo o emitirlo cuando esté listo.");
      router.push(`/invoices/${created.id}`);
      router.refresh();
    } catch (submitError) {
      const message = errorMessage(submitError, "No se pudo crear la factura rectificativa.");
      setError(message);
      toast.error(message);
    } finally {
      setPending(null);
    }
  }

  /** Enter guarda un borrador: emitir es irreversible y siempre pasa por la confirmación. */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit("draft");
  }

  function requestIssue() {
    setError(null);
    if (validate()) setIssueDialogOpen(true);
  }

  return (
    <form className="space-y-4" data-testid="credit-note-form" noValidate onSubmit={handleSubmit}>
      <fieldset className="space-y-2">
        <legend className="font-mono text-xs font-bold uppercase tracking-wide">1. ¿Qué quieres hacer?</legend>
        <label className="flex cursor-pointer items-start gap-2 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 text-sm">
          <input checked={scope === "FULL" && type === "DIFFERENCES"} className="mt-1 accent-primary" name="credit-note-scope" onChange={() => { setScope("FULL"); setType("DIFFERENCES"); }} type="radio" />
          <span>
            <span className="block font-medium">Anular la factura entera</span>
            <span className="text-xs text-muted-foreground">Emite una rectificativa por el importe total en negativo. Úsalo si la factura no debió emitirse o tenía un error grave.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 text-sm">
          <input checked={scope === "PARTIAL" && type === "DIFFERENCES"} className="mt-1 accent-primary" name="credit-note-scope" onChange={() => { setScope("PARTIAL"); setType("DIFFERENCES"); }} type="radio" />
          <span>
            <span className="block font-medium">Abonar solo una parte</span>
            <span className="text-xs text-muted-foreground">Devoluciones, descuentos posteriores o un precio mal puesto: indica las cantidades o importes que devuelves.</span>
          </span>
        </label>
        <details className="rounded-[2px] border border-dashed border-window-shadow p-2 text-sm" open={type === "SUBSTITUTION"}>
          <summary className="cursor-pointer font-mono text-xs">Opciones avanzadas</summary>
          <label className="mt-2 flex cursor-pointer items-start gap-2">
            <input checked={type === "SUBSTITUTION"} className="mt-1 accent-primary" name="credit-note-scope" onChange={() => setType("SUBSTITUTION")} type="radio" />
            <span>
              <span className="block font-medium">{rectificationTypeLabels.SUBSTITUTION}</span>
              <span className="text-xs text-muted-foreground">La rectificativa anula las líneas originales y contiene las líneas correctas. Ajusta abajo los datos correctos.</span>
            </span>
          </label>
        </details>
      </fieldset>

      {usesLines ? (
        <section aria-labelledby="credit-note-lines-title" className="space-y-2">
          <h3 className="font-mono text-xs font-bold uppercase tracking-wide" id="credit-note-lines-title">
            {type === "SUBSTITUTION" ? "Líneas correctas" : "Importes que se abonan"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {type === "SUBSTITUTION"
              ? "Escribe los datos como deberían haber sido. Se mantienen los impuestos de cada línea original."
              : "Indica en positivo lo que devuelves: por ejemplo, 1 unidad de 3, o el importe del descuento. Elimina las líneas que no cambian."}
          </p>
          <div className="space-y-2">
            {editableLines.map((line, index) => (
              <div className="grid gap-2 rounded-[2px] border border-window-dark-shadow bg-card p-2 md:grid-cols-[minmax(12rem,1fr)_6rem_8rem_minmax(8rem,.6fr)_auto] md:items-end" data-testid={`credit-note-line-${index + 1}`} key={line.key}>
                <AccessibleField id={`credit-note-line-${index + 1}-description`} label="Concepto">
                  <Input id={`credit-note-line-${index + 1}-description`} value={line.description} onChange={(event) => updateLine(line.key, { description: event.target.value })} />
                </AccessibleField>
                <AccessibleField id={`credit-note-line-${index + 1}-quantity`} label="Cantidad">
                  <QuantityInput id={`credit-note-line-${index + 1}-quantity`} value={line.quantityInput} onChange={(event) => updateLine(line.key, { quantityInput: event.target.value })} />
                </AccessibleField>
                <AccessibleField id={`credit-note-line-${index + 1}-price`} label="Precio">
                  <MoneyInput id={`credit-note-line-${index + 1}-price`} value={line.unitPriceInput} onChange={(event) => updateLine(line.key, { unitPriceInput: event.target.value })} />
                </AccessibleField>
                <p className="pb-2 text-xs text-muted-foreground">{lineTaxLabel(line)}</p>
                <Button aria-label={`Quitar línea ${index + 1}`} onClick={() => setEditableLines((current) => current.filter((candidate) => candidate.key !== line.key))} size="sm" type="button" variant="outline">
                  Quitar
                </Button>
              </div>
            ))}
            {editableLines.length === 0 ? (
              <Button onClick={() => setEditableLines(toEditable(lines))} size="sm" type="button" variant="outline">Recuperar las líneas de la factura</Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <AccessibleField helperText="Causa legal de la rectificación (art. 15 RD 1619/2012). Si dudas, «R4 · Otras causas»." id="credit-note-reason" label="2. Causa" required>
          <Select data-testid="credit-note-reason" id="credit-note-reason" value={reason} onChange={(event) => setReason(event.target.value as RectificationReason)}>
            {RECTIFICATION_REASONS.map((code) => <option key={code} value={code}>{rectificationReasonLabels[code]}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField helperText="No puede ser anterior a la factura original." id="credit-note-issue-date" label="Fecha de la rectificativa" required>
          <Input id="credit-note-issue-date" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
        </AccessibleField>
        <AccessibleField className="md:col-span-2" helperText="Aparecerá en la rectificativa. Ejemplo: «Devolución de 1 unidad defectuosa»." id="credit-note-description" label="3. Motivo" required>
          <Textarea data-testid="credit-note-description" id="credit-note-description" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
        </AccessibleField>
      </div>

      <dl className="ml-auto w-full max-w-sm space-y-1 rounded-[2px] border border-window-dark-shadow bg-window-panel p-3 font-mono text-sm" data-testid="credit-note-preview">
        <div className="flex justify-between gap-3"><dt>Base</dt><dd>{formatMoney(preview.subtotal, currencyCode)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Impuestos</dt><dd>{formatMoney(preview.taxAmount, currencyCode)}</dd></div>
        {preview.retentionAmount !== 0 ? <div className="flex justify-between gap-3"><dt>Retenciones</dt><dd>−{formatMoney(preview.retentionAmount, currencyCode)}</dd></div> : null}
        <div className="flex justify-between gap-3 font-bold"><dt>Total rectificativa</dt><dd data-testid="credit-note-total">{formatMoney(preview.totalAmount, currencyCode)}</dd></div>
      </dl>
      {exceedsPending ? (
        <InlineAlert tone="danger">El abono supera lo pendiente de rectificar ({formatMoney(pendingToRectify, currencyCode)}).</InlineAlert>
      ) : null}

      <FormErrorMessage>{error}</FormErrorMessage>
      <div className="flex flex-wrap justify-end gap-2">
        <SubmitButton data-testid="credit-note-save-draft" pending={pending === "draft"} pendingLabel="Guardando…" variant="outline">
          Guardar borrador
        </SubmitButton>
        <Button data-testid="credit-note-submit" disabled={pending !== null} onClick={requestIssue} type="button">
          {pending === "issue" ? "Emitiendo…" : "Emitir rectificativa"}
        </Button>
      </div>
      <IssueConfirmDialog
        error={error}
        isCreditNote
        onClose={() => setIssueDialogOpen(false)}
        onConfirm={() => void submit("issue")}
        open={issueDialogOpen}
        pending={pending === "issue"}
        summary={<p>Rectifica <strong>{invoiceNumber}</strong> · Total <strong className="font-mono">{formatMoney(preview.totalAmount, currencyCode)}</strong></p>}
      />
    </form>
  );
}
