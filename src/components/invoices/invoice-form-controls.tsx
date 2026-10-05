"use client";

import { CaretDown } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { DismissibleDetails, LineErrorText, LinesEditor, PICKER_OPTION, PICKER_PANEL, PICKER_SUMMARY, type LinesEditorRow } from "@/components/invoices/lines-editor";
import { formatMoney, formatPercent } from "@/lib/format";
import type { calculateInvoiceTotals } from "@/lib/invoice-totals";
import { paymentMethodTypeLabels, type PaymentMethodType } from "@/lib/payment-methods";
import { cn } from "@/lib/utils";

export type InvoiceTaxOption = {
  id: string;
  name: string;
  rate: number;
  kind: string;
  operation: "ADD" | "SUBTRACT";
  isDefault: boolean;
  isActive?: boolean;
};

export type InvoicePaymentMethodOption = {
  id: string;
  name: string;
  type: PaymentMethodType;
  bankAccountNumber: string | null;
  isDefault: boolean;
};

export type InvoiceEditorLine = {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  discountPct?: number;
  taxIds?: string[];
};

/** Descuento vacío = 0 % (nunca NaN): "10" o "10,5". */
export const discountRegisterOptions = {
  setValueAs: (value: unknown) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const text = typeof value === "string" ? value.trim().replace(",", ".") : "";
    if (!text) return 0;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  },
} as const;

type InvoiceTotals = ReturnType<typeof calculateInvoiceTotals>;

type LineBindings = {
  description: UseFormRegisterReturn;
  quantity: UseFormRegisterReturn;
  unitPrice: UseFormRegisterReturn;
  /** Descuento % de la línea (opcional). */
  discountPct?: UseFormRegisterReturn;
  taxIds: () => UseFormRegisterReturn;
};

type LineError = {
  description?: string;
  quantity?: string;
  unitPrice?: string;
  discountPct?: string;
  taxIds?: string;
};

export function InvoicePaymentMethodsField({
  error,
  getBinding,
  methods,
  selectedIds,
}: {
  error?: string;
  getBinding: () => UseFormRegisterReturn;
  methods: InvoicePaymentMethodOption[];
  selectedIds: string[];
}) {
  const selected = methods.filter((method) => selectedIds.includes(method.id));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-xs font-bold">Formas de pago</p>
        <span className="text-xs text-muted-foreground">{selected.length === 0 ? "Ninguna seleccionada" : `${selected.length} seleccionada${selected.length === 1 ? "" : "s"}`}</span>
      </div>
      <DismissibleDetails data-testid="invoice-payment-methods-picker">
        <summary className={PICKER_SUMMARY}>
          <span className="min-w-0 truncate">
            {selected.length > 0 ? selected.map((method) => method.name).join(" · ") : "Seleccionar formas de pago"}
          </span>
          <CaretDown className="shrink-0 motion-safe:transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className={cn(PICKER_PANEL, "max-h-72")}>
          {methods.map((method) => (
            <label className={cn(PICKER_OPTION, "items-start")} key={method.id}>
              <input className="mt-0.5 size-4 shrink-0 accent-primary" type="checkbox" value={method.id} {...getBinding()} />
              <span className="min-w-0">
                <span className="block font-bold">{method.name}{method.isDefault ? " · Predeterminada" : ""}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {paymentMethodTypeLabels[method.type]}{method.bankAccountNumber ? ` · ${method.bankAccountNumber}` : ""}
                </span>
              </span>
            </label>
          ))}
          {methods.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No hay formas de pago configuradas. Créalas en Configuración › Maestros.</p> : null}
        </div>
      </DismissibleDetails>
      <LineErrorText>{error}</LineErrorText>
    </div>
  );
}

/**
 * Adaptador react-hook-form del editor de líneas único (`LinesEditor`): varios
 * impuestos por línea (`taxIds`) y bindings `register()` no controlados.
 */
export function InvoiceLinesEditor({
  errors,
  fields,
  getBindings,
  lines,
  onAdd,
  onDuplicate,
  onMove,
  onRemove,
  taxes,
  totals,
}: {
  errors: LineError[];
  fields: Array<{ id: string }>;
  getBindings: (index: number) => LineBindings;
  lines: InvoiceEditorLine[];
  onAdd: () => void;
  onDuplicate: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  taxes: InvoiceTaxOption[];
  totals: InvoiceTotals;
}) {
  const rows: LinesEditorRow[] = fields.map((field, index) => {
    const bindings = getBindings(index);
    const lineError = errors[index] ?? {};
    const lineTotal = totals.lines[index];
    return {
      key: field.id,
      description: bindings.description,
      quantity: bindings.quantity,
      unitPrice: bindings.unitPrice,
      discountPct: bindings.discountPct,
      taxCheckbox: () => bindings.taxIds(),
      selectedTaxIds: lines[index]?.taxIds ?? [],
      total: { amount: lineTotal?.lineTotal ?? 0, base: lineTotal?.taxes.length ? lineTotal.subtotal : null },
      errors: { ...lineError, tax: lineError.taxIds },
    };
  });
  return (
    <LinesEditor
      addTestId="invoice-add-line"
      idPrefix="invoice-line"
      onAdd={onAdd}
      onDuplicate={onDuplicate}
      onMove={onMove}
      onRemove={onRemove}
      rows={rows}
      tax={{ kind: "multi", taxes }}
      title="Líneas de factura"
      titleId="invoice-lines-title"
      totalLabel="Total"
      withDiscount
    />
  );
}

export function InvoiceTotalsSummary({
  currencyCode = "EUR",
  error,
  testIdPrefix = "invoice",
  title = "Resumen",
  totals,
}: {
  currencyCode?: string;
  error?: ReactNode;
  /** Prefix of the data-testids ("invoice" → invoice-totals, invoice-grand-total…). */
  testIdPrefix?: string;
  title?: string;
  totals: InvoiceTotals;
}) {
  const breakdown = new Map<string, { name: string; rate: number; operation: "ADD" | "SUBTRACT"; amount: number; base: number }>();
  for (const line of totals.lines) {
    for (const tax of line.taxes) {
      const key = `${tax.name}-${tax.rate}-${tax.operation}`;
      const current = breakdown.get(key) ?? { name: tax.name ?? (tax.operation === "SUBTRACT" ? "Retención" : "Impuesto"), rate: tax.rate, operation: tax.operation, amount: 0, base: 0 };
      current.amount = Math.round((current.amount + tax.amount + Number.EPSILON) * 100) / 100;
      current.base = Math.round((current.base + tax.baseAmount + Number.EPSILON) * 100) / 100;
      breakdown.set(key, current);
    }
  }
  const money = (value: number) => formatMoney(value, currencyCode);
  return (
    <aside aria-label={title} className="border-l-4 border-l-primary bg-window-panel p-3" aria-live="polite" data-testid={`${testIdPrefix}-totals`}>
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-window-shadow pb-2">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.05em]">{title}</p>
        <p className="font-mono text-lg font-bold tabular-nums" data-testid={`${testIdPrefix}-grand-total`}>Total: {money(totals.totalAmount)}</p>
      </div>
      <dl className="space-y-1 font-mono text-xs tabular-nums">
        <div className="flex justify-between gap-3" data-testid={`${testIdPrefix}-subtotal`}><dt>Subtotal:</dt>{" "}<dd>{money(totals.subtotal)}</dd></div>
        {[...breakdown.values()].map((row) => (
          <div className="flex justify-between gap-3 text-muted-foreground" key={`${row.name}-${row.rate}-${row.operation}`}>
            <dt>
              {row.operation === "SUBTRACT" ? "−" : "+"} {row.name} {formatPercent(row.rate)}
              <span className="ml-1 text-xs">(base {money(row.base)})</span>
            </dt>
            <dd>{row.operation === "SUBTRACT" ? "−" : ""}{money(row.amount)}</dd>
          </div>
        ))}
        {totals.retentionAmount > 0 ? (
          <div className="flex justify-between gap-3 text-muted-foreground" data-testid={`${testIdPrefix}-retention-total`}>
            <dt>Retenciones:</dt>
            <dd>−{money(totals.retentionAmount)}</dd>
          </div>
        ) : null}
        <div className="sr-only" data-testid={`${testIdPrefix}-tax-total`}>Impuestos añadidos: {money(totals.taxAmount)}</div>
      </dl>
      {error ? <div className="mt-2 font-mono text-xs text-danger-text" role="alert">{error}</div> : null}
    </aside>
  );
}
