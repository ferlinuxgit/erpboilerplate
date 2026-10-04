"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

import {
  focusFirstVisible,
  LineActions,
  LineEditorRow,
  LineEditorSection,
  LineEditorTable,
  LineField,
  LineFooter,
  LineTotal,
  type LineColumn,
} from "@/components/invoices/line-editor-parts";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput, QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { formatMoney, formatPercent, parseDecimalInput } from "@/lib/format";
import { calculateInvoiceTotals, type InvoiceTotals } from "@/lib/invoice-totals";

/**
 * Controlled line editor shared by sales quotes, sales orders and purchase
 * orders. Shares its building blocks with the invoice editor
 * (`InvoiceLinesEditor`, see `line-editor-parts.tsx`): same columns, mobile
 * cards, keyboard flow (Enter advances, Enter on the price adds a line, Alt+L adds a
 * line), duplicate / reorder / remove and live totals.
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

export const standardVatRates = [21, 10, 4, 0];
/** IRPF withholding rates commonly used on Spanish professional invoices. */
export const standardRetentionRates = [0, 7, 15, 19];

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
  // Ids candidatos para el foco tras añadir/mover/quitar: se usa el primero visible.
  const [pendingFocus, setPendingFocus] = useState<string[] | null>(null);
  const totals = documentLinesTotals(lines, { retentionRate, withTax });
  const withCatalog = Boolean(catalog?.length);
  const titleId = `${idPrefix}s-title`;
  const columns: LineColumn[] = [
    withCatalog ? { label: "Artículo" } : null,
    { label: "Concepto" },
    { label: "Cantidad", numeric: true },
    { label: "Precio unitario", numeric: true },
    withDiscount ? { label: "Dto.", numeric: true } : null,
    withTax ? { label: "IVA" } : null,
    { label: "Importe", numeric: true },
    { label: "Acciones" },
  ].filter((column): column is LineColumn => column !== null);
  // Arbitrary grid tracks must be literal strings for Tailwind to generate them.
  const gridTemplates: Record<string, string> = {
    "": "lg:grid-cols-[minmax(13rem,1fr)_6rem_8rem_7.5rem_7.5rem]",
    t: "lg:grid-cols-[minmax(13rem,1fr)_6rem_8rem_6.5rem_7.5rem_7.5rem]",
    d: "lg:grid-cols-[minmax(13rem,1fr)_6rem_8rem_5rem_7.5rem_7.5rem]",
    dt: "lg:grid-cols-[minmax(13rem,1fr)_6rem_8rem_5rem_6.5rem_7.5rem_7.5rem]",
    c: "lg:grid-cols-[minmax(10rem,.6fr)_minmax(13rem,1fr)_6rem_8rem_7.5rem_7.5rem]",
    ct: "lg:grid-cols-[minmax(10rem,.6fr)_minmax(13rem,1fr)_6rem_8rem_6.5rem_7.5rem_7.5rem]",
    cd: "lg:grid-cols-[minmax(10rem,.6fr)_minmax(13rem,1fr)_6rem_8rem_5rem_7.5rem_7.5rem]",
    cdt: "lg:grid-cols-[minmax(10rem,.6fr)_minmax(13rem,1fr)_6rem_8rem_5rem_6.5rem_7.5rem_7.5rem]",
  };
  const gridTemplate = gridTemplates[`${withCatalog ? "c" : ""}${withDiscount ? "d" : ""}${withTax ? "t" : ""}`];

  useEffect(() => {
    if (!pendingFocus) return;
    const frame = requestAnimationFrame(() => {
      focusFirstVisible(pendingFocus);
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus, lines.length]);

  const fieldId = (index: number, field: string) => `${idPrefix}-${index + 1}-${field}`;
  const update = (index: number, patch: Partial<DocumentLineDraft>) =>
    onChange(lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  const add = () => {
    onChange([...lines, createDocumentLine({ taxRate: withTax ? String(defaultTaxRate) : undefined })]);
    setPendingFocus([fieldId(lines.length, withCatalog ? "item" : "description")]);
  };
  const duplicate = (index: number) => {
    const source = lines[index];
    if (!source) return;
    const { key: _key, ...rest } = source;
    void _key;
    onChange([...lines.slice(0, index + 1), createDocumentLine(rest), ...lines.slice(index + 1)]);
    setPendingFocus([fieldId(index + 1, "description")]);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= lines.length) return;
    const next = [...lines];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
    // En móvil los botones de mover están en el menú «Más»: el foco va al concepto.
    setPendingFocus([`${idPrefix}-${to + 1}-${from > to ? "move-up" : "move-down"}`, fieldId(to, "description")]);
  };
  const remove = (index: number) => {
    if (lines.length === 1) return;
    onChange(lines.filter((_, lineIndex) => lineIndex !== index));
    setPendingFocus([fieldId(Math.max(0, index - 1), "description")]);
  };
  const advanceOnEnter = (event: KeyboardEvent<HTMLElement>, nextId: string | null, index: number) => {
    if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (nextId) document.getElementById(nextId)?.focus();
    else if (index === lines.length - 1) add();
    else document.getElementById(fieldId(index + 1, withCatalog ? "item" : "description"))?.focus();
  };

  const taxOptions = (current: string | undefined) => {
    const parsed = parseDecimalInput(current);
    const rates = new Set(standardVatRates);
    if (parsed !== null) rates.add(parsed);
    rates.add(defaultTaxRate);
    return [...rates].sort((left, right) => right - left);
  };

  return (
    <LineEditorSection
      addTestId={`${idPrefix}-add`}
      count={lines.length}
      description={description}
      onAdd={add}
      onKeyDown={(event) => {
        if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key.toLowerCase() === "l" || event.code === "KeyL")) {
          event.preventDefault();
          add();
        }
      }}
      title={title}
      titleId={titleId}
    >
      <LineEditorTable columns={columns} gridTemplate={gridTemplate}>
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const lineErrors = errors[index] ?? {};
          const lineTotal = totals.lines[index];
          const ids = {
            item: fieldId(index, "item"),
            description: fieldId(index, "description"),
            quantity: fieldId(index, "quantity"),
            unitPrice: fieldId(index, "unit-price"),
            taxRate: fieldId(index, "tax-rate"),
            discountPct: fieldId(index, "discount"),
          };
          const errorId = (field: keyof DocumentLineErrors) => (lineErrors[field] ? `${ids[field]}-error` : undefined);
          const fieldProps = (field: keyof DocumentLineErrors) => ({ error: lineErrors[field], errorId: errorId(field), lineNumber });
          return (
            <LineEditorRow gridTemplate={gridTemplate} key={line.key} lineNumber={lineNumber} testId={`${idPrefix}-${lineNumber}`}>
              {withCatalog ? (
                <LineField htmlFor={ids.item} label="Artículo" lineNumber={lineNumber} wide>
                  <Select
                    className="h-9"
                    id={ids.item}
                    onChange={(event) => {
                      const selected = catalog?.find((entry) => entry.id === event.target.value);
                      update(index, {
                        itemId: event.target.value,
                        ...(selected
                          ? { description: selected.description, ...(selected.unitPrice !== null && selected.unitPrice !== undefined ? { unitPrice: String(selected.unitPrice) } : {}) }
                          : {}),
                      });
                    }}
                    onKeyDown={(event) => advanceOnEnter(event, ids.description, index)}
                    value={line.itemId ?? ""}
                  >
                    <option value="">Concepto libre</option>
                    {catalog?.map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.label}</option>
                    ))}
                  </Select>
                </LineField>
              ) : null}
              <LineField {...fieldProps("description")} htmlFor={ids.description} label="Concepto" wide>
                <div className="flex items-center gap-1">
                  <span aria-hidden="true" className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">{lineNumber}</span>
                  <Input
                    aria-describedby={errorId("description")}
                    aria-invalid={Boolean(lineErrors.description) || undefined}
                    className="h-9"
                    data-testid={ids.description}
                    id={ids.description}
                    onChange={(event) => update(index, { description: event.target.value })}
                    onKeyDown={(event) => advanceOnEnter(event, ids.quantity, index)}
                    placeholder="Producto o servicio"
                    required
                    value={line.description}
                  />
                </div>
              </LineField>
              <LineField {...fieldProps("quantity")} htmlFor={ids.quantity} label="Cantidad">
                <QuantityInput
                  aria-describedby={errorId("quantity")}
                  aria-invalid={Boolean(lineErrors.quantity) || undefined}
                  className="h-9"
                  data-testid={ids.quantity}
                  id={ids.quantity}
                  onChange={(event) => update(index, { quantity: event.target.value })}
                  onKeyDown={(event) => advanceOnEnter(event, ids.unitPrice, index)}
                  required
                  value={line.quantity}
                />
              </LineField>
              <LineField {...fieldProps("unitPrice")} htmlFor={ids.unitPrice} label="Precio unitario">
                <MoneyInput
                  aria-describedby={errorId("unitPrice")}
                  aria-invalid={Boolean(lineErrors.unitPrice) || undefined}
                  className="h-9"
                  data-testid={ids.unitPrice}
                  id={ids.unitPrice}
                  onChange={(event) => update(index, { unitPrice: event.target.value })}
                  onKeyDown={(event) => advanceOnEnter(event, withDiscount ? ids.discountPct : withTax ? ids.taxRate : null, index)}
                  required
                  value={line.unitPrice}
                />
              </LineField>
              {withDiscount ? (
                <LineField {...fieldProps("discountPct")} htmlFor={ids.discountPct} label="Descuento (%)">
                  <PercentInput
                    aria-describedby={errorId("discountPct")}
                    aria-invalid={Boolean(lineErrors.discountPct) || undefined}
                    className="h-9"
                    data-testid={ids.discountPct}
                    id={ids.discountPct}
                    onChange={(event) => update(index, { discountPct: event.target.value })}
                    onKeyDown={(event) => advanceOnEnter(event, withTax ? ids.taxRate : null, index)}
                    placeholder="0"
                    value={line.discountPct ?? ""}
                  />
                </LineField>
              ) : null}
              {withTax ? (
                <LineField {...fieldProps("taxRate")} htmlFor={ids.taxRate} label="IVA">
                  <Select
                    aria-describedby={errorId("taxRate")}
                    aria-invalid={Boolean(lineErrors.taxRate) || undefined}
                    className="h-9"
                    data-testid={ids.taxRate}
                    id={ids.taxRate}
                    onChange={(event) => update(index, { taxRate: event.target.value })}
                    onKeyDown={(event) => advanceOnEnter(event, null, index)}
                    value={String(parseDecimalInput(line.taxRate) ?? defaultTaxRate)}
                  >
                    {taxOptions(line.taxRate).map((rate) => (
                      <option key={rate} value={String(rate)}>
                        {rate === 0 ? "Exento 0 %" : `IVA ${formatPercent(rate)}`}
                      </option>
                    ))}
                  </Select>
                </LineField>
              ) : null}
              <LineFooter>
                <LineTotal
                  amount={formatMoney(lineTotal?.lineTotal ?? 0, currencyCode)}
                  base={lineTotal && (lineTotal.taxAmount || lineTotal.retentionAmount || parseDecimalInput(line.discountPct)) ? formatMoney(lineTotal.subtotal, currencyCode) : null}
                  label="Importe"
                />
                <LineActions canRemove={lines.length > 1} idPrefix={idPrefix} index={index} lineCount={lines.length} onDuplicate={duplicate} onMove={move} onRemove={remove} />
              </LineFooter>
            </LineEditorRow>
          );
        })}
      </LineEditorTable>
    </LineEditorSection>
  );
}
