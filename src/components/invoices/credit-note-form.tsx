"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { IssueConfirmDialog } from "@/components/invoices/invoice-lifecycle-actions";
import { LinesEditor, type LinesEditorRow } from "@/components/invoices/lines-editor";
import { Button } from "@/components/ui/button";
import { AccessibleField, FormErrorMessage, SubmitButton, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";
import { calculateInvoiceTotals, type InvoiceCalculationTax } from "@/lib/invoice-totals";
import {
  COMMERCIAL_REASONS,
  RECTIFICATION_REASONS,
  commercialReasonAccountingHelp,
  commercialReasonLabels,
  rectificationReasonLabels,
  type CommercialReason,
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
  /** Suplido (art. 78.Tres.3.º LIVA): se abona sin impuestos y fuera de la base. */
  isDisbursement?: boolean;
  /**
   * Línea de descuento global o de anticipo descontado: entra en la anulación total y en la
   * sustitución, pero no se edita en una rectificativa parcial (se indican los importes netos).
   */
  isDeduction?: boolean;
};

type EditableLine = CreditNoteSourceLine & { key: string; quantityInput: string; unitPriceInput: string };

type Scope = "FULL" | "PARTIAL";
type Direction = "DECREASE" | "INCREASE";

function toEditable(lines: CreditNoteSourceLine[]): EditableLine[] {
  return lines.filter((line) => !line.isDeduction).map((line, index) => ({
    ...line,
    key: `line-${index}`,
    quantityInput: String(line.quantity).replace(".", ","),
    unitPriceInput: line.unitPrice.toFixed(2).replace(".", ","),
  }));
}

function lineTaxLabel(line: CreditNoteSourceLine) {
  if (line.isDisbursement) return "Suplido (sin impuestos)";
  if (line.taxes.length > 0) return line.taxes.map((selectedTax) => `${selectedTax.operation === "SUBTRACT" ? "−" : "+"}${selectedTax.name ?? "Impuesto"}`).join(" ");
  const parts = [line.taxRate > 0 ? `IVA ${line.taxRate}%` : null, line.retentionRate > 0 ? `−Ret. ${line.retentionRate}%` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Sin impuestos";
}

/**
 * Formulario de factura rectificativa pensado para no expertos:
 * 1) ¿Qué quieres hacer? (anular entera / abonar una parte / añadir lo que faltaba) → 2) motivo
 * comercial y causa legal → 3) explicación. Todas se expresan por diferencias, que es como constan
 * en el registro VERI*FACTU; la opción avanzada anula las líneas originales y añade las correctas.
 */
export type CreditNoteDraftValues = {
  creditNoteId: string;
  reason: RectificationReason;
  type: RectificationType;
  scope: Scope;
  description: string;
  /** Rectificación parcial al alza: las líneas se añaden en lugar de abonarse. */
  direction?: Direction;
  commercialReason?: CommercialReason | null;
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
  showAccounts = false,
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
  /** Plan contable español: explica a qué cuenta (708, 709 o ventas) va cada motivo comercial. */
  showAccounts?: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>(draft?.scope ?? "FULL");
  const [type, setType] = useState<RectificationType>(draft?.type ?? "DIFFERENCES");
  const [direction, setDirection] = useState<Direction>(draft?.direction ?? "DECREASE");
  const [commercialReason, setCommercialReason] = useState<CommercialReason>(draft?.commercialReason ?? "ERROR");
  const [reason, setReason] = useState<RectificationReason>(draft?.reason ?? "R4");
  const increase = scope === "PARTIAL" && type === "DIFFERENCES" && direction === "INCREASE";
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
    type === "SUBSTITUTION" ? [...negate(lines), ...parsedLines.map(forCalculation)] : scope === "FULL" ? negate(lines) : increase ? parsedLines.map(forCalculation) : negate(parsedLines),
    { allowNegative: true },
  );

  // Importe de cada línea con su signo en la rectificativa: en negativo lo que se abona, en positivo las líneas correctas.
  const lineAmounts = calculateInvoiceTotals(type === "SUBSTITUTION" || increase ? parsedLines.map(forCalculation) : negate(parsedLines), { allowNegative: true }).lines;
  // Las líneas vienen de la factura original: no se añaden ni se reordenan, solo se ajustan o se quitan (incluso todas).
  const lineRows: LinesEditorRow[] = editableLines.map((line, index) => ({
    key: line.key,
    description: { value: line.description, onChange: (event) => updateLine(line.key, { description: event.target.value }) },
    quantity: { value: line.quantityInput, onChange: (event) => updateLine(line.key, { quantityInput: event.target.value }) },
    unitPrice: { value: line.unitPriceInput, onChange: (event) => updateLine(line.key, { unitPriceInput: event.target.value }) },
    taxText: lineTaxLabel(line),
    total: { amount: lineAmounts[index]?.lineTotal ?? 0 },
  }));

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
          direction: increase ? "INCREASE" : "DECREASE",
          // Una rectificación al alza nunca es una devolución ni un descuento.
          commercialReason: increase ? "ERROR" : commercialReason,
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
                    ...(line.isDisbursement ? { isDisbursement: true } : {}),
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
        <label className="flex cursor-pointer items-start gap-2 rounded-surface border border-window-dark-shadow bg-window-panel p-3 text-sm">
          <input checked={scope === "FULL" && type === "DIFFERENCES"} className="mt-1 accent-primary" name="credit-note-scope" onChange={() => { setScope("FULL"); setType("DIFFERENCES"); setDirection("DECREASE"); }} type="radio" />
          <span>
            <span className="block font-medium">Anular la factura entera</span>
            <span className="text-xs text-muted-foreground">Emite una rectificativa por el importe total en negativo. Úsalo si la factura no debió emitirse o tenía un error grave.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-surface border border-window-dark-shadow bg-window-panel p-3 text-sm">
          <input checked={scope === "PARTIAL" && type === "DIFFERENCES" && !increase} className="mt-1 accent-primary" name="credit-note-scope" onChange={() => { setScope("PARTIAL"); setType("DIFFERENCES"); setDirection("DECREASE"); }} type="radio" />
          <span>
            <span className="block font-medium">Abonar solo una parte</span>
            <span className="text-xs text-muted-foreground">Devoluciones, descuentos posteriores o un precio mal puesto: indica las cantidades o importes que devuelves.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-surface border border-window-dark-shadow bg-window-panel p-3 text-sm">
          <input checked={increase} className="mt-1 accent-primary" data-testid="credit-note-increase" name="credit-note-scope" onChange={() => { setScope("PARTIAL"); setType("DIFFERENCES"); setDirection("INCREASE"); setCommercialReason("ERROR"); }} type="radio" />
          <span>
            <span className="block font-medium">Añadir un importe que faltaba</span>
            <span className="text-xs text-muted-foreground">Facturaste de menos por error (precio o cantidad por debajo, IVA más bajo del debido): la rectificativa sale en positivo y aumenta lo que te debe el cliente.</span>
          </span>
        </label>
        <details className="rounded-surface border border-dashed border-window-shadow p-2 text-sm" open={type === "SUBSTITUTION"}>
          <summary className="cursor-pointer font-mono text-xs">Opciones avanzadas</summary>
          <label className="mt-2 flex cursor-pointer items-start gap-2">
            <input checked={type === "SUBSTITUTION"} className="mt-1 accent-primary" name="credit-note-scope" onChange={() => { setType("SUBSTITUTION"); setDirection("DECREASE"); }} type="radio" />
            <span>
              <span className="block font-medium">Anular las líneas originales y facturar las correctas</span>
              <span className="text-xs text-muted-foreground">La rectificativa lleva las líneas originales en negativo y las correctas en positivo: el total es la diferencia. Es también una rectificación por diferencias. Ajusta abajo los datos correctos.</span>
            </span>
          </label>
        </details>
      </fieldset>

      {usesLines ? (
        <LinesEditor
          currencyCode={currencyCode}
          description={
            type === "SUBSTITUTION"
              ? "Escribe los datos como deberían haber sido. Se mantienen los impuestos de cada línea original."
              : increase
                ? "Indica en positivo lo que faltaba por facturar: por ejemplo, la diferencia de precio. Quita las líneas que no cambian."
                : "Indica en positivo lo que devuelves: por ejemplo, 1 unidad de 3, o el importe del descuento. Quita las líneas que no cambian."
          }
          empty={<Button onClick={() => setEditableLines(toEditable(lines))} size="sm" type="button" variant="outline">Recuperar las líneas de la factura</Button>}
          headingLevel={3}
          idPrefix="credit-note-line"
          minLines={0}
          onRemove={(index) => setEditableLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
          removeVerb="Quitar"
          rows={lineRows}
          tax={{ kind: "fixed" }}
          title={type === "SUBSTITUTION" ? "Líneas correctas" : increase ? "Importes que se añaden" : "Importes que se abonan"}
          titleId="credit-note-lines-title"
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {!increase ? (
          <AccessibleField
            className="md:col-span-2"
            helperText={showAccounts ? commercialReasonAccountingHelp[commercialReason] : "Sirve para clasificar el abono en la contabilidad."}
            id="credit-note-commercial-reason"
            label="2. ¿Por qué se abona?"
            required
          >
            <Select
              data-testid="credit-note-commercial-reason"
              id="credit-note-commercial-reason"
              onChange={(event) => {
                const next = event.target.value as CommercialReason;
                setCommercialReason(next);
                // Devoluciones y descuentos posteriores son causas del art. 80 de la Ley del IVA (clave R1).
                if (next !== "ERROR" && reason === "R4") setReason("R1");
                if (next === "ERROR" && reason === "R1") setReason("R4");
              }}
              value={commercialReason}
            >
              {COMMERCIAL_REASONS.map((code) => <option key={code} value={code}>{commercialReasonLabels[code]}</option>)}
            </Select>
          </AccessibleField>
        ) : null}
        <AccessibleField helperText="Causa legal de la rectificación (art. 15 RD 1619/2012). Si dudas, «R4 · Resto de causas»; para devoluciones y descuentos, «R1»." id="credit-note-reason" label="Causa legal" required>
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

      <dl className="ml-auto w-full max-w-sm space-y-1 rounded-surface border border-window-dark-shadow bg-window-panel p-3 font-mono text-sm" data-testid="credit-note-preview">
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
