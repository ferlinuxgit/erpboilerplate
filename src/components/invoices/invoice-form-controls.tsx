"use client";

import { ArrowDown, ArrowUp, CaretDown, Copy, Plus, Trash } from "@phosphor-icons/react";
import type { KeyboardEvent, ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput, QuantityInput } from "@/components/ui/number-input";
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
  taxIds?: string[];
};

type InvoiceTotals = ReturnType<typeof calculateInvoiceTotals>;

type LineBindings = {
  description: UseFormRegisterReturn;
  quantity: UseFormRegisterReturn;
  unitPrice: UseFormRegisterReturn;
  taxIds: () => UseFormRegisterReturn;
};

type LineError = {
  description?: string;
  quantity?: string;
  unitPrice?: string;
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
        <p className="font-mono text-[0.72rem] font-bold">Formas de pago</p>
        <span className="text-[0.68rem] text-muted-foreground">{selected.length === 0 ? "Ninguna seleccionada" : `${selected.length} seleccionada${selected.length === 1 ? "" : "s"}`}</span>
      </div>
      <details className="group relative" data-testid="invoice-payment-methods-picker">
        <summary className="flex h-9 cursor-pointer list-none items-center justify-between gap-3 rounded-[2px] border border-window-dark-shadow bg-window-highlight px-2 font-mono text-[0.75rem] outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate">
            {selected.length > 0 ? selected.map((method) => method.name).join(" · ") : "Seleccionar formas de pago"}
          </span>
          <CaretDown className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-1 max-h-72 overflow-y-auto rounded-[2px] border border-window-dark-shadow bg-popover p-1.5 shadow-[2px_2px_0_var(--window-shadow)]">
          {methods.map((method) => (
            <label className="flex cursor-pointer items-start gap-2 rounded-[1px] px-2 py-2 font-mono text-xs hover:bg-window-panel" key={method.id}>
              <input className="mt-0.5 size-4 accent-primary" type="checkbox" value={method.id} {...getBinding()} />
              <span className="min-w-0">
                <span className="block font-bold">{method.name}{method.isDefault ? " · Predeterminada" : ""}</span>
                <span className="block truncate font-mono text-[0.68rem] text-muted-foreground">
                  {paymentMethodTypeLabels[method.type]}{method.bankAccountNumber ? ` · ${method.bankAccountNumber}` : ""}
                </span>
              </span>
            </label>
          ))}
          {methods.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No hay formas de pago configuradas. Créalas en Configuración › Maestros.</p> : null}
        </div>
      </details>
      {error ? <p className="font-mono text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}

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
  const focus = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());
  const handleFieldEnter = (event: KeyboardEvent<HTMLInputElement>, targetId: string) => {
    if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    focus(targetId);
  };
  const handlePriceEnter = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (index === fields.length - 1) onAdd();
    else focus(`invoice-line-${index + 2}-description`);
  };

  return (
    <section className="space-y-2" aria-labelledby="invoice-lines-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="invoice-lines-title" className="font-mono text-sm font-bold">Líneas de factura</h2>
          <p className="text-xs text-muted-foreground">Enter avanza por la fila; desde el precio crea la siguiente línea. Alt+L añade una línea desde cualquier campo.</p>
        </div>
        <Button aria-keyshortcuts="Alt+L" data-testid="invoice-add-line" type="button" variant="outline" onClick={onAdd}>
          <Plus aria-hidden="true" />
          Añadir línea
        </Button>
      </div>

      <div className="overflow-visible rounded-[2px] border border-window-dark-shadow bg-window-surface">
        <div className="hidden grid-cols-[minmax(13rem,1fr)_5.5rem_7rem_minmax(10rem,.7fr)_7rem_7.5rem] gap-px border-b border-window-dark-shadow bg-window-dark-shadow lg:grid">
          {['Concepto', 'Cantidad', 'Precio', 'Impuestos', 'Total', 'Acciones'].map((label) => (
            <div className="bg-window-panel px-2 py-1.5 font-mono text-[0.67rem] font-bold uppercase tracking-[0.04em]" key={label}>{label}</div>
          ))}
        </div>
        <div className="divide-y divide-window-shadow">
          {fields.map((field, index) => {
            const lineNumber = index + 1;
            const descriptionId = `invoice-line-${lineNumber}-description`;
            const quantityId = `invoice-line-${lineNumber}-quantity`;
            const unitPriceId = `invoice-line-${lineNumber}-unit-price`;
            const bindings = getBindings(index);
            const line = lines[index] ?? {};
            const lineError = errors[index] ?? {};
            const lineTotal = totals.lines[index];
            const selectedTaxes = taxes.filter((tax) => line.taxIds?.includes(tax.id));
            return (
              <article className="grid gap-2 bg-card p-2 lg:grid-cols-[minmax(13rem,1fr)_5.5rem_7rem_minmax(10rem,.7fr)_7rem_7.5rem] lg:items-start lg:gap-1" data-testid={`invoice-line-${lineNumber}`} key={field.id}>
                <div className="space-y-1">
                  <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={descriptionId}>Concepto</label>
                  <div className="flex items-center gap-1">
                    <span className="w-5 shrink-0 text-center font-mono text-[0.68rem] text-muted-foreground">{lineNumber}</span>
                    <Input
                      className="h-9"
                      data-testid={descriptionId}
                      id={descriptionId}
                      aria-label={`Descripción línea ${lineNumber}`}
                      aria-invalid={Boolean(lineError.description)}
                      aria-describedby={lineError.description ? `${descriptionId}-error` : undefined}
                      placeholder="Descripción del producto o servicio"
                      onKeyDown={(event) => handleFieldEnter(event, quantityId)}
                      {...bindings.description}
                    />
                  </div>
                  {lineError.description ? <p className="pl-6 text-xs text-destructive" id={`${descriptionId}-error`} role="alert">{lineError.description}</p> : null}
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={quantityId}>Cantidad</label>
                  <QuantityInput
                    className="h-9"
                    data-testid={quantityId}
                    id={quantityId}
                    aria-label={`Cantidad línea ${lineNumber}`}
                    aria-invalid={Boolean(lineError.quantity)}
                    aria-describedby={lineError.quantity ? `${quantityId}-error` : undefined}
                    onKeyDown={(event) => handleFieldEnter(event, unitPriceId)}
                    {...bindings.quantity}
                  />
                  {lineError.quantity ? <p className="text-xs text-destructive" id={`${quantityId}-error`} role="alert">{lineError.quantity}</p> : null}
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={unitPriceId}>Precio unitario</label>
                  <MoneyInput
                    className="h-9"
                    data-testid={unitPriceId}
                    id={unitPriceId}
                    aria-label={`Precio unitario línea ${lineNumber}`}
                    aria-invalid={Boolean(lineError.unitPrice)}
                    aria-describedby={lineError.unitPrice ? `${unitPriceId}-error` : undefined}
                    onKeyDown={(event) => handlePriceEnter(event, index)}
                    {...bindings.unitPrice}
                  />
                  {lineError.unitPrice ? <p className="text-xs text-destructive" id={`${unitPriceId}-error`} role="alert">{lineError.unitPrice}</p> : null}
                </div>
                <div className="space-y-1">
                  <span className="font-mono text-[0.67rem] font-bold lg:sr-only">Impuestos</span>
                  <details className="group relative" data-testid={`invoice-line-${lineNumber}-taxes`}>
                    <summary aria-label={`Impuestos línea ${lineNumber}`} className="flex h-9 cursor-pointer list-none items-center justify-between gap-1 rounded-[1px] border border-window-dark-shadow bg-window-highlight px-2 font-mono text-[0.7rem] outline-none focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
                      <span className="truncate">{selectedTaxes.length ? selectedTaxes.map((tax) => tax.name).join(" · ") : "Sin impuestos"}</span>
                      <CaretDown className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div className="mt-1 max-h-64 min-w-72 overflow-y-auto rounded-[2px] border border-window-dark-shadow bg-popover p-1.5 shadow-[2px_2px_0_var(--window-shadow)] lg:min-w-0">
                      {taxes.map((tax) => (
                        <label className={cn("flex cursor-pointer items-center gap-2 rounded-[1px] px-2 py-2 font-mono text-xs hover:bg-window-panel", tax.isActive === false && "opacity-60")} key={tax.id}>
                          <input className="size-4 accent-primary" type="checkbox" value={tax.id} {...bindings.taxIds()} />
                          <span className="flex min-w-0 flex-1 justify-between gap-3">
                            <span className="truncate">{tax.name}{tax.isActive === false ? " (archivado)" : ""}</span>
                            <span className="shrink-0 font-mono text-muted-foreground">{tax.operation === "SUBTRACT" ? "−" : "+"}{formatPercent(tax.rate)}</span>
                          </span>
                        </label>
                      ))}
                      {taxes.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No hay impuestos configurados. Créalos en Configuración › Maestros.</p> : null}
                    </div>
                  </details>
                  {lineError.taxIds ? <p className="text-xs text-destructive" role="alert">{lineError.taxIds}</p> : null}
                </div>
                <div className="flex min-h-9 items-center justify-between gap-2 lg:justify-end">
                  <span className="font-mono text-[0.67rem] font-bold lg:hidden">Total</span>
                  <div className="text-right font-mono text-[0.78rem] font-bold tabular-nums">
                    {formatMoney(lineTotal?.lineTotal ?? 0)}
                    {lineTotal?.taxes.length ? <p className="text-[0.62rem] font-normal text-muted-foreground">Base {formatMoney(lineTotal.subtotal)}</p> : null}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-0.5" role="group" aria-label={`Acciones línea ${lineNumber}`}>
                  <Button aria-label={`Subir línea ${lineNumber}`} title="Subir" size="icon-sm" type="button" variant="ghost" disabled={index === 0} onClick={() => onMove(index, index - 1)}><ArrowUp aria-hidden="true" /></Button>
                  <Button aria-label={`Bajar línea ${lineNumber}`} title="Bajar" size="icon-sm" type="button" variant="ghost" disabled={index === fields.length - 1} onClick={() => onMove(index, index + 1)}><ArrowDown aria-hidden="true" /></Button>
                  <Button aria-label={`Duplicar línea ${lineNumber}`} title="Duplicar" size="icon-sm" type="button" variant="ghost" onClick={() => onDuplicate(index)}><Copy aria-hidden="true" /></Button>
                  <Button aria-label={`Eliminar línea ${lineNumber}`} title="Eliminar" size="icon-sm" type="button" variant="ghost" disabled={fields.length === 1} onClick={() => onRemove(index)}><Trash aria-hidden="true" /></Button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{fields.length} línea{fields.length === 1 ? "" : "s"}</p>
        <Button type="button" size="sm" variant="ghost" onClick={onAdd}><Plus aria-hidden="true" />Añadir otra línea</Button>
      </div>
    </section>
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
        <p className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.05em]">{title}</p>
        <p className="font-mono text-lg font-bold tabular-nums" data-testid={`${testIdPrefix}-grand-total`}>Total: {money(totals.totalAmount)}</p>
      </div>
      <dl className="space-y-1 font-mono text-[0.72rem] tabular-nums">
        <div className="flex justify-between gap-3" data-testid={`${testIdPrefix}-subtotal`}><dt>Subtotal:</dt>{" "}<dd>{money(totals.subtotal)}</dd></div>
        {[...breakdown.values()].map((row) => (
          <div className="flex justify-between gap-3 text-muted-foreground" key={`${row.name}-${row.rate}-${row.operation}`}>
            <dt>
              {row.operation === "SUBTRACT" ? "−" : "+"} {row.name} {formatPercent(row.rate)}
              <span className="ml-1 text-[0.65rem]">(base {money(row.base)})</span>
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
      {error ? <div className="mt-2 font-mono text-xs text-destructive" role="alert">{error}</div> : null}
    </aside>
  );
}
