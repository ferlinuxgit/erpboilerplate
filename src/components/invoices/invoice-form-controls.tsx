"use client";

import { CaretDown } from "@phosphor-icons/react";
import type { KeyboardEvent, ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import {
  DismissibleDetails,
  LineActions,
  LineEditorRow,
  LineEditorSection,
  LineEditorTable,
  LineErrorText,
  LineField,
  LineFooter,
  LineTotal,
  type LineColumn,
} from "@/components/invoices/line-editor-parts";
import { Input } from "@/components/ui/input";
import { MoneyInput, PercentInput, QuantityInput } from "@/components/ui/number-input";
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

/** Nombre accesible del selector de impuestos: incluye los impuestos elegidos. */
export function taxPickerLabel(lineNumber: number, selectedNames: string[]) {
  return `Impuestos línea ${lineNumber}: ${selectedNames.length ? selectedNames.join(", ") : "sin impuestos"}`;
}

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

const LINE_GRID = "lg:grid-cols-[minmax(13rem,1fr)_5.5rem_7rem_5rem_minmax(10rem,.7fr)_7rem_7.5rem]";
const LINE_COLUMNS: LineColumn[] = [
  { label: "Concepto" },
  { label: "Cantidad", numeric: true },
  { label: "Precio", numeric: true },
  { label: "Dto.", numeric: true },
  { label: "Impuestos" },
  { label: "Total", numeric: true },
  { label: "Acciones" },
];

/** Estilos compartidos de los desplegables con casillas (impuestos, formas de pago). */
const PICKER_SUMMARY =
  "flex h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-control border border-window-dark-shadow bg-window-highlight px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:h-10 [&::-webkit-details-marker]:hidden";
// En el flujo del documento (no flotante): nunca se sale de pantallas estrechas.
const PICKER_PANEL = "mt-1 w-full min-w-0 max-w-full overflow-y-auto rounded-surface border border-window-dark-shadow bg-popover p-1.5 shadow-drop-sm";
const PICKER_OPTION = "flex cursor-pointer gap-2 rounded-control px-2 py-2 font-mono text-xs hover:bg-window-panel pointer-coarse:min-h-10";

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
  const isPlainEnter = (event: KeyboardEvent<HTMLElement>) => event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey;
  const handleFieldEnter = (event: KeyboardEvent<HTMLInputElement>, targetId: string) => {
    if (!isPlainEnter(event)) return;
    event.preventDefault();
    focus(targetId);
  };
  const handlePriceEnter = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (!isPlainEnter(event)) return;
    event.preventDefault();
    if (index === fields.length - 1) onAdd();
    else focus(`invoice-line-${index + 2}-description`);
  };

  return (
    <LineEditorSection
      addTestId="invoice-add-line"
      count={fields.length}
      description="Enter avanza por la fila; desde el precio crea la siguiente línea. Alt+L añade una línea desde cualquier campo."
      onAdd={onAdd}
      title="Líneas de factura"
      titleId="invoice-lines-title"
    >
      <LineEditorTable columns={LINE_COLUMNS} gridTemplate={LINE_GRID}>
        {fields.map((field, index) => {
          const lineNumber = index + 1;
          const descriptionId = `invoice-line-${lineNumber}-description`;
          const quantityId = `invoice-line-${lineNumber}-quantity`;
          const unitPriceId = `invoice-line-${lineNumber}-unit-price`;
          const discountId = `invoice-line-${lineNumber}-discount`;
          const bindings = getBindings(index);
          const line = lines[index] ?? {};
          const lineError = errors[index] ?? {};
          const lineTotal = totals.lines[index];
          const selectedTaxes = taxes.filter((tax) => line.taxIds?.includes(tax.id));
          const errorId = (id: string, message?: string) => (message ? `${id}-error` : undefined);
          return (
            <LineEditorRow as="article" gridTemplate={LINE_GRID} key={field.id} lineNumber={lineNumber} testId={`invoice-line-${lineNumber}`}>
              <LineField error={lineError.description} errorId={errorId(descriptionId, lineError.description)} htmlFor={descriptionId} label="Concepto" lineNumber={lineNumber} wide>
                <div className="flex items-center gap-1">
                  <span aria-hidden="true" className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">{lineNumber}</span>
                  <Input
                    className="h-9"
                    data-testid={descriptionId}
                    id={descriptionId}
                    aria-invalid={Boolean(lineError.description)}
                    aria-describedby={errorId(descriptionId, lineError.description)}
                    placeholder="Descripción del producto o servicio"
                    onKeyDown={(event) => handleFieldEnter(event, quantityId)}
                    {...bindings.description}
                  />
                </div>
              </LineField>
              <LineField error={lineError.quantity} errorId={errorId(quantityId, lineError.quantity)} htmlFor={quantityId} label="Cantidad" lineNumber={lineNumber}>
                <QuantityInput
                  className="h-9"
                  data-testid={quantityId}
                  id={quantityId}
                  aria-invalid={Boolean(lineError.quantity)}
                  aria-describedby={errorId(quantityId, lineError.quantity)}
                  onKeyDown={(event) => handleFieldEnter(event, unitPriceId)}
                  {...bindings.quantity}
                />
              </LineField>
              <LineField error={lineError.unitPrice} errorId={errorId(unitPriceId, lineError.unitPrice)} htmlFor={unitPriceId} label="Precio unitario" lineNumber={lineNumber}>
                <MoneyInput
                  className="h-9"
                  data-testid={unitPriceId}
                  id={unitPriceId}
                  aria-invalid={Boolean(lineError.unitPrice)}
                  aria-describedby={errorId(unitPriceId, lineError.unitPrice)}
                  onKeyDown={(event) => handlePriceEnter(event, index)}
                  {...bindings.unitPrice}
                />
              </LineField>
              {bindings.discountPct ? (
                <LineField error={lineError.discountPct} errorId={errorId(discountId, lineError.discountPct)} htmlFor={discountId} label="Descuento (%)" lineNumber={lineNumber}>
                  <PercentInput
                    className="h-9"
                    data-testid={discountId}
                    id={discountId}
                    aria-invalid={Boolean(lineError.discountPct)}
                    aria-describedby={errorId(discountId, lineError.discountPct)}
                    placeholder="0"
                    onKeyDown={(event) => handlePriceEnter(event, index)}
                    {...bindings.discountPct}
                  />
                </LineField>
              ) : <span aria-hidden="true" className="hidden lg:block" />}
              <LineField error={lineError.taxIds} label="Impuestos" lineNumber={lineNumber}>
                <LineTaxPicker binding={bindings.taxIds} lineNumber={lineNumber} selectedTaxes={selectedTaxes} taxes={taxes} />
              </LineField>
              <LineFooter>
                <LineTotal
                  amount={formatMoney(lineTotal?.lineTotal ?? 0)}
                  base={lineTotal?.taxes.length ? formatMoney(lineTotal.subtotal) : null}
                  label="Total"
                />
                <LineActions canRemove={fields.length > 1} index={index} lineCount={fields.length} onDuplicate={onDuplicate} onMove={onMove} onRemove={onRemove} />
              </LineFooter>
            </LineEditorRow>
          );
        })}
      </LineEditorTable>
    </LineEditorSection>
  );
}

/** Desplegable de impuestos de una línea (casillas): se cierra al pulsar fuera o con Escape. */
function LineTaxPicker({
  binding,
  lineNumber,
  selectedTaxes,
  taxes,
}: {
  binding: () => UseFormRegisterReturn;
  lineNumber: number;
  selectedTaxes: InvoiceTaxOption[];
  taxes: InvoiceTaxOption[];
}) {
  const signedRate = (tax: InvoiceTaxOption) => `${tax.operation === "SUBTRACT" ? "−" : ""}${formatPercent(tax.rate)}`;
  return (
    <DismissibleDetails data-testid={`invoice-line-${lineNumber}-taxes`}>
      <summary aria-label={taxPickerLabel(lineNumber, selectedTaxes.map((tax) => `${tax.name} ${signedRate(tax)}`))} className={PICKER_SUMMARY}>
        <span className="truncate">{selectedTaxes.length ? selectedTaxes.map((tax) => tax.name).join(" · ") : "Sin impuestos"}</span>
        <CaretDown className="shrink-0 motion-safe:transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className={cn(PICKER_PANEL, "max-h-64")}>
        {taxes.map((tax) => (
          <label className={cn(PICKER_OPTION, "items-center", tax.isActive === false && "opacity-60")} key={tax.id}>
            <input className="size-4 shrink-0 accent-primary" type="checkbox" value={tax.id} {...binding()} />
            <span className="flex min-w-0 flex-1 justify-between gap-2">
              <span className="truncate">{tax.name}{tax.isActive === false ? " (archivado)" : ""}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{tax.operation === "SUBTRACT" ? "−" : "+"}{formatPercent(tax.rate)}</span>
            </span>
          </label>
        ))}
        {taxes.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No hay impuestos configurados. Créalos en Configuración › Maestros.</p> : null}
      </div>
    </DismissibleDetails>
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
