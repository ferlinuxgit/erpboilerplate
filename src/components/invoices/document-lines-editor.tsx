"use client";

import { ArrowDown, ArrowUp, Copy, Plus, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput, QuantityInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { formatMoney, formatPercent, parseDecimalInput } from "@/lib/format";
import { calculateInvoiceTotals, type InvoiceTotals } from "@/lib/invoice-totals";
import { cn } from "@/lib/utils";

/**
 * Controlled line editor shared by sales quotes, sales orders and purchase
 * orders. Mirrors the invoice editor (`InvoiceLinesEditor`): same columns,
 * keyboard flow (Enter advances, Enter on the price adds a line, Alt+L adds a
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
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const totals = documentLinesTotals(lines, { retentionRate, withTax });
  const withCatalog = Boolean(catalog?.length);
  const titleId = `${idPrefix}s-title`;
  const columns = [
    withCatalog ? "Artículo" : null,
    "Concepto",
    "Cantidad",
    "Precio unitario",
    withDiscount ? "Dto." : null,
    withTax ? "IVA" : null,
    "Importe",
    "Acciones",
  ].filter(Boolean) as string[];
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
      document.getElementById(pendingFocus)?.focus();
      setPendingFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus, lines.length]);

  const fieldId = (index: number, field: string) => `${idPrefix}-${index + 1}-${field}`;
  const update = (index: number, patch: Partial<DocumentLineDraft>) =>
    onChange(lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));
  const add = () => {
    onChange([...lines, createDocumentLine({ taxRate: withTax ? String(defaultTaxRate) : undefined })]);
    setPendingFocus(fieldId(lines.length, withCatalog ? "item" : "description"));
  };
  const duplicate = (index: number) => {
    const source = lines[index];
    if (!source) return;
    const { key: _key, ...rest } = source;
    void _key;
    onChange([...lines.slice(0, index + 1), createDocumentLine(rest), ...lines.slice(index + 1)]);
    setPendingFocus(fieldId(index + 1, "description"));
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= lines.length) return;
    const next = [...lines];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
    setPendingFocus(`${idPrefix}-${to + 1}-${from > to ? "move-up" : "move-down"}`);
  };
  const remove = (index: number) => {
    if (lines.length === 1) return;
    onChange(lines.filter((_, lineIndex) => lineIndex !== index));
    setPendingFocus(fieldId(Math.max(0, index - 1), "description"));
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
    <section
      aria-labelledby={titleId}
      className="space-y-2"
      onKeyDown={(event) => {
        if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key.toLowerCase() === "l" || event.code === "KeyL")) {
          event.preventDefault();
          add();
        }
      }}
      ref={sectionRef}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-mono text-sm font-bold" id={titleId}>{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button aria-keyshortcuts="Alt+L" data-testid={`${idPrefix}-add`} onClick={add} type="button" variant="outline">
          <Plus aria-hidden="true" />
          Añadir línea
        </Button>
      </div>

      <div className="rounded-[2px] border border-window-dark-shadow bg-window-surface">
        <div aria-hidden="true" className={cn("hidden gap-px border-b border-window-dark-shadow bg-window-dark-shadow lg:grid", gridTemplate)}>
          {columns.map((label) => (
            <div className={cn("bg-window-panel px-2 py-1.5 font-mono text-[0.67rem] font-bold uppercase tracking-[0.04em]", (label === "Importe" || label === "Cantidad" || label === "Precio unitario") && "text-right")} key={label}>
              {label}
            </div>
          ))}
        </div>
        <div className="divide-y divide-window-shadow">
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
            const errorId = (field: keyof typeof ids) => (lineErrors[field as keyof DocumentLineErrors] ? `${ids[field]}-error` : undefined);
            return (
              <fieldset className={cn("grid gap-2 bg-card p-2 lg:items-start lg:gap-1", gridTemplate)} data-testid={`${idPrefix}-${lineNumber}`} key={line.key}>
                <legend className="sr-only">Línea {lineNumber}</legend>
                {withCatalog ? (
                  <div className="space-y-1">
                    <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={ids.item}>Artículo</label>
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
                  </div>
                ) : null}
                <div className="space-y-1">
                  <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={ids.description}>
                    Concepto<span className="sr-only"> de la línea {lineNumber}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <span aria-hidden="true" className="w-5 shrink-0 text-center font-mono text-[0.68rem] text-muted-foreground">{lineNumber}</span>
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
                  {lineErrors.description ? <p className="pl-6 text-xs text-destructive" id={`${ids.description}-error`} role="alert">{lineErrors.description}</p> : null}
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={ids.quantity}>
                    Cantidad<span className="sr-only"> de la línea {lineNumber}</span>
                  </label>
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
                  {lineErrors.quantity ? <p className="text-xs text-destructive" id={`${ids.quantity}-error`} role="alert">{lineErrors.quantity}</p> : null}
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={ids.unitPrice}>
                    Precio unitario<span className="sr-only"> de la línea {lineNumber}</span>
                  </label>
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
                  {lineErrors.unitPrice ? <p className="text-xs text-destructive" id={`${ids.unitPrice}-error`} role="alert">{lineErrors.unitPrice}</p> : null}
                </div>
                {withDiscount ? (
                  <div className="space-y-1">
                    <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={ids.discountPct}>
                      Descuento<span className="sr-only"> de la línea {lineNumber}</span>
                    </label>
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
                    {lineErrors.discountPct ? <p className="text-xs text-destructive" id={`${ids.discountPct}-error`} role="alert">{lineErrors.discountPct}</p> : null}
                  </div>
                ) : null}
                {withTax ? (
                  <div className="space-y-1">
                    <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={ids.taxRate}>
                      IVA<span className="sr-only"> de la línea {lineNumber}</span>
                    </label>
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
                    {lineErrors.taxRate ? <p className="text-xs text-destructive" id={`${ids.taxRate}-error`} role="alert">{lineErrors.taxRate}</p> : null}
                  </div>
                ) : null}
                <div className="flex min-h-9 items-center justify-between gap-2 lg:justify-end">
                  <span className="font-mono text-[0.67rem] font-bold lg:hidden">Importe</span>
                  <div className="text-right font-mono text-[0.78rem] font-bold tabular-nums">
                    {formatMoney(lineTotal?.lineTotal ?? 0, currencyCode)}
                    {lineTotal && (lineTotal.taxAmount || lineTotal.retentionAmount || parseDecimalInput(line.discountPct)) ? (
                      <p className="text-[0.62rem] font-normal text-muted-foreground">Base {formatMoney(lineTotal.subtotal, currencyCode)}</p>
                    ) : null}
                  </div>
                </div>
                <div aria-label={`Acciones línea ${lineNumber}`} className="flex items-center justify-end gap-0.5" role="group">
                  <Button aria-label={`Subir línea ${lineNumber}`} disabled={index === 0} id={`${idPrefix}-${lineNumber}-move-up`} onClick={() => move(index, index - 1)} size="icon-sm" title="Subir" type="button" variant="ghost"><ArrowUp aria-hidden="true" /></Button>
                  <Button aria-label={`Bajar línea ${lineNumber}`} disabled={index === lines.length - 1} id={`${idPrefix}-${lineNumber}-move-down`} onClick={() => move(index, index + 1)} size="icon-sm" title="Bajar" type="button" variant="ghost"><ArrowDown aria-hidden="true" /></Button>
                  <Button aria-label={`Duplicar línea ${lineNumber}`} onClick={() => duplicate(index)} size="icon-sm" title="Duplicar" type="button" variant="ghost"><Copy aria-hidden="true" /></Button>
                  <Button aria-label={`Eliminar línea ${lineNumber}`} disabled={lines.length === 1} onClick={() => remove(index)} size="icon-sm" title="Eliminar" type="button" variant="ghost"><Trash aria-hidden="true" /></Button>
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{lines.length} línea{lines.length === 1 ? "" : "s"}</p>
        <Button onClick={add} size="sm" type="button" variant="ghost"><Plus aria-hidden="true" />Añadir otra línea</Button>
      </div>
    </section>
  );
}
