"use client";

import { ArrowDown, ArrowUp, CaretDown, Copy, Plus, Trash } from "@phosphor-icons/react";
import type { KeyboardEvent, ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
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
            <label className="flex cursor-pointer items-start gap-2 rounded-[1px] px-2 py-2 text-sm hover:bg-window-panel" key={method.id}>
              <input className="mt-0.5 size-4 accent-primary" type="checkbox" value={method.id} {...getBinding()} />
              <span className="min-w-0">
                <span className="block font-medium">{method.name}{method.isDefault ? " · Predeterminada" : ""}</span>
                <span className="block truncate font-mono text-[0.68rem] text-muted-foreground">
                  {paymentMethodTypeLabels[method.type]}{method.bankAccountNumber ? ` · ${method.bankAccountNumber}` : ""}
                </span>
              </span>
            </label>
          ))}
          {methods.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No hay formas de pago configuradas.</p> : null}
        </div>
      </details>
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
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
          <h3 id="invoice-lines-title" className="font-mono text-sm font-bold">Líneas de factura</h3>
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
                      placeholder="Descripción del producto o servicio"
                      onKeyDown={(event) => handleFieldEnter(event, quantityId)}
                      {...bindings.description}
                    />
                  </div>
                  {lineError.description ? <p className="pl-6 text-xs text-red-600" role="alert">{lineError.description}</p> : null}
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={quantityId}>Cantidad</label>
                  <Input
                    className="h-9 text-right tabular-nums"
                    data-testid={quantityId}
                    id={quantityId}
                    aria-label={`Cantidad línea ${lineNumber}`}
                    aria-invalid={Boolean(lineError.quantity)}
                    min={0.001}
                    step="0.001"
                    type="number"
                    onKeyDown={(event) => handleFieldEnter(event, unitPriceId)}
                    {...bindings.quantity}
                  />
                  {lineError.quantity ? <p className="text-xs text-red-600" role="alert">{lineError.quantity}</p> : null}
                </div>
                <div className="space-y-1">
                  <label className="font-mono text-[0.67rem] font-bold lg:sr-only" htmlFor={unitPriceId}>Precio unitario</label>
                  <Input
                    className="h-9 text-right tabular-nums"
                    data-testid={unitPriceId}
                    id={unitPriceId}
                    aria-label={`Precio unitario línea ${lineNumber}`}
                    aria-invalid={Boolean(lineError.unitPrice)}
                    min={0}
                    step="0.01"
                    type="number"
                    onKeyDown={(event) => handlePriceEnter(event, index)}
                    {...bindings.unitPrice}
                  />
                  {lineError.unitPrice ? <p className="text-xs text-red-600" role="alert">{lineError.unitPrice}</p> : null}
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
                        <label className={cn("flex cursor-pointer items-center gap-2 rounded-[1px] px-2 py-2 text-sm hover:bg-window-panel", tax.isActive === false && "opacity-60")} key={tax.id}>
                          <input className="size-4 accent-primary" type="checkbox" value={tax.id} {...bindings.taxIds()} />
                          <span className="flex min-w-0 flex-1 justify-between gap-3">
                            <span className="truncate">{tax.name}{tax.isActive === false ? " (archivado)" : ""}</span>
                            <span className="shrink-0 font-mono text-muted-foreground">{tax.operation === "SUBTRACT" ? "−" : "+"}{tax.rate.toLocaleString("es-ES")}%</span>
                          </span>
                        </label>
                      ))}
                      {taxes.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No hay impuestos configurados.</p> : null}
                    </div>
                  </details>
                  {lineError.taxIds ? <p className="text-xs text-red-600" role="alert">{lineError.taxIds}</p> : null}
                </div>
                <div className="flex min-h-9 items-center justify-between gap-2 lg:justify-end">
                  <span className="font-mono text-[0.67rem] font-bold lg:hidden">Total</span>
                  <div className="text-right font-mono text-[0.78rem] font-bold tabular-nums">
                    {formatMoney(lineTotal?.lineTotal ?? 0)}
                    {lineTotal?.taxes.length ? <p className="text-[0.62rem] font-normal text-muted-foreground">Base {formatMoney(lineTotal.subtotal)}</p> : null}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-0.5" role="group" aria-label={`Acciones línea ${lineNumber}`}>
                  <Button aria-label={`Subir línea ${lineNumber}`} title="Subir" size="icon-sm" type="button" variant="ghost" disabled={index === 0} onClick={() => onMove(index, index - 1)}><ArrowUp /></Button>
                  <Button aria-label={`Bajar línea ${lineNumber}`} title="Bajar" size="icon-sm" type="button" variant="ghost" disabled={index === fields.length - 1} onClick={() => onMove(index, index + 1)}><ArrowDown /></Button>
                  <Button aria-label={`Duplicar línea ${lineNumber}`} title="Duplicar" size="icon-sm" type="button" variant="ghost" onClick={() => onDuplicate(index)}><Copy /></Button>
                  <Button aria-label={`Eliminar línea ${lineNumber}`} title="Eliminar" size="icon-sm" type="button" variant="ghost" disabled={fields.length === 1} onClick={() => onRemove(index)}><Trash /></Button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{fields.length} línea{fields.length === 1 ? "" : "s"}</p>
        <Button type="button" size="sm" variant="ghost" onClick={onAdd}><Plus />Añadir otra línea</Button>
      </div>
    </section>
  );
}

export function InvoiceTotalsSummary({ error, totals }: { error?: ReactNode; totals: InvoiceTotals }) {
  const breakdown = new Map<string, { name: string; rate: number; operation: "ADD" | "SUBTRACT"; amount: number }>();
  for (const line of totals.lines) {
    for (const tax of line.taxes) {
      const key = `${tax.name}-${tax.rate}-${tax.operation}`;
      const current = breakdown.get(key) ?? { name: tax.name ?? (tax.operation === "SUBTRACT" ? "Retención" : "Impuesto"), rate: tax.rate, operation: tax.operation, amount: 0 };
      current.amount = Math.round((current.amount + tax.amount + Number.EPSILON) * 100) / 100;
      breakdown.set(key, current);
    }
  }
  return (
    <aside className="border-l-4 border-l-primary bg-window-panel p-3" aria-live="polite" data-testid="invoice-totals">
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-window-shadow pb-2">
        <p className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.05em]">Resumen</p>
        <p className="font-mono text-lg font-bold tabular-nums" data-testid="invoice-grand-total">Total: {formatMoney(totals.totalAmount)}</p>
      </div>
      <dl className="space-y-1 font-mono text-[0.72rem] tabular-nums">
        <div className="flex justify-between gap-3" data-testid="invoice-subtotal"><dt>Subtotal:</dt>{" "}<dd>{formatMoney(totals.subtotal)}</dd></div>
        {[...breakdown.values()].map((row) => (
          <div className="flex justify-between gap-3 text-muted-foreground" key={`${row.name}-${row.rate}-${row.operation}`}>
            <dt>{row.operation === "SUBTRACT" ? "−" : "+"} {row.name} {row.rate.toLocaleString("es-ES")}%</dt>
            <dd>{formatMoney(row.amount)}</dd>
          </div>
        ))}
        <div className="sr-only" data-testid="invoice-tax-total">Impuestos añadidos: {formatMoney(totals.taxAmount)}</div>
      </dl>
      {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
    </aside>
  );
}
