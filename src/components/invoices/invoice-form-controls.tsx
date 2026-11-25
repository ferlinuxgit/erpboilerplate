"use client";

import { PencilSimple } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { useController, type Control, type FieldValues, type Path, type UseFormRegisterReturn } from "react-hook-form";

import { LineErrorText, LinesEditor, type LinesEditorRow } from "@/components/invoices/lines-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
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
  /** Artículo del catálogo (opcional: solo si el editor recibe `itemOptions`). */
  item?: UseFormRegisterReturn;
  description: UseFormRegisterReturn;
  quantity: UseFormRegisterReturn;
  unitPrice: UseFormRegisterReturn;
  /** Descuento % de la línea (opcional). */
  discountPct?: UseFormRegisterReturn;
  /** Impuestos de la línea (los dos desplegables «IVA» y «Retención» la cambian entera). */
  setTaxIds: (taxIds: string[]) => void;
};

type LineError = {
  description?: string;
  quantity?: string;
  unitPrice?: string;
  discountPct?: string;
  taxIds?: string;
};

/**
 * Formas de pago de la factura: un botón con las elegidas que abre un diálogo con una casilla por
 * forma de pago; se aplica al pulsar «Aplicar». El campo se registra con `useController` (no
 * depende de que las casillas estén montadas).
 */
export function InvoicePaymentMethodsField<T extends FieldValues>({
  control,
  error,
  methods,
  name,
}: {
  control: Control<T>;
  error?: string;
  methods: InvoicePaymentMethodOption[];
  name: Path<T>;
}) {
  const { field } = useController({ control, name });
  const selectedIds: string[] = Array.isArray(field.value) ? field.value : [];
  const selected = methods.filter((method) => selectedIds.includes(method.id));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const summary = selected.length > 0 ? selected.map((method) => method.name).join(" · ") : "Seleccionar formas de pago";

  const openDialog = () => {
    setDraft(selectedIds);
    setOpen(true);
  };
  const toggle = (id: string, checked: boolean) => setDraft((current) => (checked ? [...current, id] : current.filter((value) => value !== id)));
  const apply = () => {
    // En el orden de la lista (el de la configuración), no en el de los clics.
    field.onChange(methods.filter((method) => draft.includes(method.id)).map((method) => method.id));
    field.onBlur();
    setOpen(false);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-xs font-bold" id="invoice-payment-methods-label">Formas de pago</p>
        <span className="text-xs text-muted-foreground">{selected.length === 0 ? "Ninguna seleccionada" : `${selected.length} seleccionada${selected.length === 1 ? "" : "s"}`}</span>
      </div>
      <Button
        aria-describedby={error ? "invoice-payment-methods-error" : undefined}
        aria-invalid={Boolean(error) || undefined}
        aria-label={`Formas de pago: ${selected.length > 0 ? summary : "ninguna"}. Cambiar`}
        className="h-9 w-full min-w-0 justify-between gap-2 px-2 font-mono text-xs font-normal"
        data-testid="invoice-payment-methods-picker"
        onClick={openDialog}
        type="button"
        variant="outline"
      >
        <span className="truncate">{summary}</span>
        <PencilSimple aria-hidden="true" className="shrink-0" />
      </Button>
      <Dialog description="Marca las que quieras mostrar en la factura." onClose={() => setOpen(false)} open={open} size="sm" title="Formas de pago">
        <fieldset className="min-w-0 space-y-1">
          <legend className="sr-only">Formas de pago de la factura</legend>
          {methods.map((method) => {
            const checked = draft.includes(method.id);
            return (
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-control border px-2 py-2 pointer-coarse:min-h-11",
                  checked ? "border-primary bg-window-panel" : "border-window-shadow hover:bg-window-panel",
                )}
                key={method.id}
              >
                <input checked={checked} className="mt-0.5 size-4 shrink-0 accent-primary" onChange={(event) => toggle(method.id, event.target.checked)} type="checkbox" value={method.id} />
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-bold">{method.name}{method.isDefault ? " · Predeterminada" : ""}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {paymentMethodTypeLabels[method.type]}{method.bankAccountNumber ? ` · ${method.bankAccountNumber}` : ""}
                  </span>
                </span>
              </label>
            );
          })}
          {methods.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No hay formas de pago configuradas. Créalas en Configuración › Cobros y pagos.</p> : null}
        </fieldset>
        <DialogFooter>
          <Button onClick={() => setOpen(false)} type="button" variant="outline">Cancelar</Button>
          <Button data-testid="invoice-payment-methods-apply" onClick={apply} type="button">Aplicar</Button>
        </DialogFooter>
      </Dialog>
      <LineErrorText id="invoice-payment-methods-error">{error}</LineErrorText>
    </div>
  );
}

/**
 * Mantiene registrado `lines.N.taxIds` aunque ningún input lo pinte (los impuestos se eligen en
 * un diálogo): con `shouldUnregister` el formulario descarta los valores no registrados y las
 * líneas perderían el IVA propuesto.
 */
function RegisteredTaxIds<T extends FieldValues>({ control, name }: { control: Control<T>; name: Path<T> }) {
  useController({ control, name });
  return null;
}

/**
 * Adaptador react-hook-form del editor de líneas único (`LinesEditor`): varios
 * impuestos por línea (`taxIds`, elegidos con dos desplegables) y bindings `register()` no controlados.
 */
export function InvoiceLinesEditor<T extends FieldValues>({
  control,
  errors,
  fields,
  getBindings,
  lines,
  onAdd,
  onDuplicate,
  onMove,
  itemOptions,
  onRemove,
  taxes,
  totals,
}: {
  /** Artículos que se pueden elegir en cada línea (columna «Artículo»). */
  itemOptions?: ReadonlyArray<{ id: string; label: string }>;
  /** Control del formulario: registra los impuestos de cada línea (`lines.N.taxIds`). */
  control: Control<T>;
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
      item: itemOptions?.length ? bindings.item : undefined,
      description: bindings.description,
      quantity: bindings.quantity,
      unitPrice: bindings.unitPrice,
      discountPct: bindings.discountPct,
      selectedTaxIds: lines[index]?.taxIds ?? [],
      onTaxIdsChange: bindings.setTaxIds,
      total: { amount: lineTotal?.lineTotal ?? 0, base: lineTotal?.taxes.length ? lineTotal.subtotal : null },
      errors: { ...lineError, tax: lineError.taxIds },
    };
  });
  return (
    <>
      {fields.map((field, index) => <RegisteredTaxIds control={control} key={`${field.id}-${index}`} name={`lines.${index}.taxIds` as Path<T>} />)}
      <LinesEditor
        addTestId="invoice-add-line"
        idPrefix="invoice-line"
        itemOptions={itemOptions?.length ? itemOptions : undefined}
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
    </>
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
