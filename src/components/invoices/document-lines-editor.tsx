"use client";

import { LinesEditor, type LinesEditorRow } from "@/components/invoices/lines-editor";
import { moveItem } from "@/components/invoices/lines-editor-model";
import { parseDecimalInput } from "@/lib/format";
import { calculateInvoiceTotals, type InvoiceTotals } from "@/lib/invoice-totals";

export { standardRetentionRates, standardVatRates } from "@/components/invoices/lines-editor-model";

/**
 * Modelo de borradores controlados de presupuestos, pedidos de venta, pedidos
 * de compra y facturas recurrentes: textos tal como se escriben, totales,
 * validación y payload. La edición la pinta `LinesEditor` (ver `lines-editor.tsx`).
 */
export type DocumentLineDraft = {
  /** Stable React key (not sent to the API). */
  key: string;
  itemId?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate?: string;
  discountPct?: string;
};

export type DocumentCatalogItem = {
  id: string;
  label: string;
  description: string;
  unitPrice?: string | number | null;
};

type TotalsOptions = { withTax: boolean; retentionRate?: number };

let lineSequence = 0;
export function createDocumentLine(patch: Partial<Omit<DocumentLineDraft, "key">> = {}): DocumentLineDraft {
  lineSequence += 1;
  return { key: `line-${lineSequence}`, description: "", quantity: "1", unitPrice: "0", ...patch };
}

export function documentLinesTotals(lines: DocumentLineDraft[], { retentionRate = 0, withTax }: TotalsOptions): InvoiceTotals {
  return calculateInvoiceTotals(
    lines.map((line) => ({
      description: line.description,
      quantity: parseDecimalInput(line.quantity) ?? 0,
      unitPrice: parseDecimalInput(line.unitPrice, { maximumFractionDigits: 2 }) ?? 0,
      discountPct: parseDecimalInput(line.discountPct) ?? 0,
      taxRate: withTax ? (parseDecimalInput(line.taxRate) ?? 0) : 0,
      retentionRate: withTax ? retentionRate : 0,
    })),
  );
}

export type DocumentLineErrors = Partial<Record<"description" | "quantity" | "unitPrice" | "taxRate" | "discountPct", string>>;

/** Client-side validation with Spanish messages, one entry per line. */
export function validateDocumentLines(lines: DocumentLineDraft[], { withTax }: { withTax: boolean }) {
  const errors = lines.map((line) => {
    const lineErrors: DocumentLineErrors = {};
    const quantity = parseDecimalInput(line.quantity);
    const unitPrice = parseDecimalInput(line.unitPrice, { maximumFractionDigits: 2 });
    const taxRate = parseDecimalInput(line.taxRate);
    const discountPct = line.discountPct?.trim() ? parseDecimalInput(line.discountPct) : 0;
    if (!line.description.trim()) lineErrors.description = "Escribe el concepto de la línea.";
    if (quantity === null || quantity <= 0) lineErrors.quantity = "La cantidad debe ser mayor que cero.";
    if (unitPrice === null || unitPrice < 0) lineErrors.unitPrice = "Indica un precio igual o mayor que cero.";
    if (discountPct === null || discountPct < 0 || discountPct > 100) lineErrors.discountPct = "El descuento debe estar entre 0 y 100 %.";
    if (withTax && (taxRate === null || taxRate < 0 || taxRate > 100)) lineErrors.taxRate = "Elige un IVA entre 0 y 100 %.";
    return lineErrors;
  });
  return { errors, isValid: errors.every((lineErrors) => Object.keys(lineErrors).length === 0) };
}

/** Converts drafts to the numeric payload expected by the APIs. */
export function documentLinesPayload(
  lines: DocumentLineDraft[],
  { retentionRate, withDiscount = false, withItem = false, withTax }: { withTax: boolean; withItem?: boolean; withDiscount?: boolean; retentionRate?: number },
) {
  return lines.map((line) => ({
    description: line.description.trim(),
    quantity: parseDecimalInput(line.quantity) ?? 0,
    unitPrice: parseDecimalInput(line.unitPrice, { maximumFractionDigits: 2 }) ?? 0,
    ...(withTax ? { taxRate: parseDecimalInput(line.taxRate) ?? 0 } : {}),
    ...(withTax && retentionRate !== undefined ? { retentionRate } : {}),
    ...(withDiscount ? { discountPct: parseDecimalInput(line.discountPct) ?? 0 } : {}),
    ...(withItem ? { itemId: line.itemId || undefined } : {}),
  }));
}

type DocumentLinesEditorProps = {
  lines: DocumentLineDraft[];
  onChange: (lines: DocumentLineDraft[]) => void;
  /** Prefix for DOM ids and test ids, e.g. "quote-line" → "quote-line-1-description". */
  idPrefix: string;
  title: string;
  description?: string;
  errors?: DocumentLineErrors[];
  withTax?: boolean;
  /** Adds a per-line discount (%) column. */
  withDiscount?: boolean;
  /** Document-level IRPF withholding applied to every line (only with tax). */
  retentionRate?: number;
  defaultTaxRate?: number;
  catalog?: DocumentCatalogItem[];
  currencyCode?: string;
};

/** Adaptador de estado controlado (borradores en texto) del editor de líneas único. */
export function DocumentLinesEditor({
  catalog,
  currencyCode = "EUR",
  defaultTaxRate = 21,
  description = "Enter avanza por la fila; desde el precio crea la siguiente línea. Alt+L añade una línea.",
  errors = [],
  idPrefix,
  lines,
  onChange,
  retentionRate = 0,
  title,
  withDiscount = false,
  withTax = true,
}: DocumentLinesEditorProps) {
  const totals = documentLinesTotals(lines, { retentionRate, withTax });
  const withCatalog = Boolean(catalog?.length);

  const update = (index: number, patch: Partial<DocumentLineDraft>) =>
    onChange(lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  const duplicate = (index: number) => {
    const source = lines[index];
    if (!source) return;
    const { key: _key, ...rest } = source;
    void _key;
    onChange([...lines.slice(0, index + 1), createDocumentLine(rest), ...lines.slice(index + 1)]);
  };

  const rows: LinesEditorRow[] = lines.map((line, index) => {
    const lineTotal = totals.lines[index];
    const lineErrors = errors[index] ?? {};
    return {
      key: line.key,
      item: withCatalog
        ? {
            value: line.itemId ?? "",
            onChange: (event) => {
              const selected = catalog?.find((entry) => entry.id === event.target.value);
              update(index, {
                itemId: event.target.value,
                ...(selected
                  ? { description: selected.description, ...(selected.unitPrice !== null && selected.unitPrice !== undefined ? { unitPrice: String(selected.unitPrice) } : {}) }
                  : {}),
              });
            },
          }
        : undefined,
      description: { value: line.description, required: true, onChange: (event) => update(index, { description: event.target.value }) },
      quantity: { value: line.quantity, required: true, onChange: (event) => update(index, { quantity: event.target.value }) },
      unitPrice: { value: line.unitPrice, required: true, onChange: (event) => update(index, { unitPrice: event.target.value }) },
      discountPct: { value: line.discountPct ?? "", onChange: (event) => update(index, { discountPct: event.target.value }) },
      taxRate: { value: String(parseDecimalInput(line.taxRate) ?? defaultTaxRate), onChange: (event) => update(index, { taxRate: event.target.value }) },
      total: {
        amount: lineTotal?.lineTotal ?? 0,
        base: lineTotal && (lineTotal.taxAmount || lineTotal.retentionAmount || parseDecimalInput(line.discountPct)) ? lineTotal.subtotal : null,
      },
      errors: { ...lineErrors, tax: lineErrors.taxRate },
    };
  });

  return (
    <LinesEditor
      currencyCode={currencyCode}
      description={description}
      idPrefix={idPrefix}
      itemOptions={withCatalog ? catalog?.map((entry) => ({ id: entry.id, label: entry.label })) : undefined}
      onAdd={() => onChange([...lines, createDocumentLine({ taxRate: withTax ? String(defaultTaxRate) : undefined })])}
      onDuplicate={duplicate}
      onMove={(from, to) => onChange(moveItem(lines, from, to))}
      onRemove={(index) => onChange(lines.filter((_, lineIndex) => lineIndex !== index))}
      rows={rows}
      tax={withTax ? { kind: "vat", defaultRate: defaultTaxRate } : { kind: "none" }}
      title={title}
      withDiscount={withDiscount}
    />
  );
}
