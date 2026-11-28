"use client";

import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatMoney, parseDecimalInput } from "@/lib/format";

/** Anticipo emitido con importe pendiente de descontar (respuesta de `GET /api/invoices/advances`). */
export type AvailableAdvance = {
  id: string;
  number: string;
  pending: Array<{ taxKey: string; amount: number; taxIds: string[]; taxRate: number; retentionRate: number }>;
};

/** Línea que descuenta un anticipo en la factura final (negativa, con los impuestos del anticipo). */
export type AdvanceDeductionLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  retentionRate: number;
  taxIds: string[];
  advanceInvoiceId: string;
};

/** Descuento vacío = 0 (nunca NaN). Acepta coma decimal. */
export const optionalAmountRegisterOptions = {
  setValueAs: (value: unknown) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return 0;
    return parseDecimalInput(text, { maximumFractionDigits: 3 }) ?? Number.NaN;
  },
} as const;

/**
 * Opciones poco frecuentes de una factura, plegadas para no estorbar:
 * - descuento global o de pronto pago concedido en la propia factura (art. 78.Tres.2.º LIVA);
 * - factura de anticipo (art. 75.Dos LIVA), cuya base se descuenta luego en la factura final;
 * - en la factura final, «Descontar anticipo» añade la línea negativa «Anticipo según factura X».
 */
export function InvoiceSpecialOptions({
  currencyCode = "EUR",
  customerId,
  discountAmount,
  discountAmountError,
  discountPct,
  discountPctError,
  excludeInvoiceId,
  initiallyOpen = false,
  isAdvance,
  isAdvanceChecked,
  onAddAdvance,
}: {
  currencyCode?: string;
  customerId?: string | null;
  discountPct: UseFormRegisterReturn;
  discountPctError?: string;
  discountAmount: UseFormRegisterReturn;
  discountAmountError?: string;
  /** Borrador que se edita: lo que ya descuenta no cuenta como consumido. */
  excludeInvoiceId?: string;
  initiallyOpen?: boolean;
  isAdvance: UseFormRegisterReturn;
  isAdvanceChecked: boolean;
  onAddAdvance: (line: AdvanceDeductionLine) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [advances, setAdvances] = useState<AvailableAdvance[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const money = (value: number) => formatMoney(value, currencyCode);

  async function openAdvances() {
    setDialogOpen(true);
    setAdvances(null);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ customerId: customerId ?? "" });
      if (excludeInvoiceId) params.set("excludeInvoiceId", excludeInvoiceId);
      const response = await fetch(`/api/invoices/advances?${params.toString()}`, { headers: { ...getCsrfHeader() } });
      if (!response.ok) throw new Error("No se pudieron cargar los anticipos del cliente.");
      setAdvances(((await response.json()) as { advances: AvailableAdvance[] }).advances);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los anticipos del cliente.");
    }
  }

  function add(advance: AvailableAdvance, pending: AvailableAdvance["pending"][number]) {
    onAddAdvance({
      description: `Anticipo según factura ${advance.number}`,
      quantity: 1,
      unitPrice: -pending.amount,
      discountPct: 0,
      taxRate: pending.taxRate,
      retentionRate: pending.retentionRate,
      taxIds: pending.taxIds,
      advanceInvoiceId: advance.id,
    });
    setDialogOpen(false);
  }

  return (
    <details className="rounded-surface border border-window-dark-shadow bg-card p-3 sm:col-span-2" data-testid="invoice-special-options" onToggle={(event) => setOpen(event.currentTarget.open)} open={open}>
      <summary className="cursor-pointer font-mono text-xs font-bold">Descuento global, anticipos y suplidos</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <AccessibleField
          error={discountPctError}
          helperText="Sobre la base de todas las líneas (también el de pronto pago). Se reparte entre los tipos de IVA."
          id="invoice-global-discount-pct"
          label="Descuento global (%)"
        >
          <Input data-testid="invoice-global-discount-pct" id="invoice-global-discount-pct" inputMode="decimal" placeholder="0" {...discountPct} />
        </AccessibleField>
        <AccessibleField
          error={discountAmountError}
          helperText="O un importe fijo sin IVA. Si pones porcentaje, manda el porcentaje."
          id="invoice-global-discount-amount"
          label="Descuento global (importe)"
        >
          <Input data-testid="invoice-global-discount-amount" id="invoice-global-discount-amount" inputMode="decimal" placeholder="0,00" {...discountAmount} />
        </AccessibleField>
        <label className="flex cursor-pointer items-start gap-2 text-sm sm:col-span-2">
          <input className="mt-0.5 size-4 accent-primary" data-testid="invoice-is-advance" type="checkbox" {...isAdvance} />
          <span>
            <span className="block font-mono text-xs font-bold">Factura de anticipo</span>
            <span className="block text-xs text-muted-foreground">Cobro antes de entregar o prestar: lleva su IVA y se descuenta después en la factura final. Se contabiliza en la 438 (anticipos de clientes), no como venta.</span>
          </span>
        </label>
        {!isAdvanceChecked ? (
          <div className="sm:col-span-2">
            <Button data-testid="invoice-add-advance" disabled={!customerId} onClick={openAdvances} size="sm" type="button" variant="outline">Descontar anticipo</Button>
            <p className="mt-1 text-xs text-muted-foreground">
              {customerId ? "Añade una línea en negativo por un anticipo ya facturado a este cliente." : "Elige antes el cliente para ver sus anticipos."}
            </p>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Suplidos: marca «Supl.» en la línea de un gasto pagado en nombre del cliente (tasas, aranceles…). Va sin IVA, fuera de la base, y se suma aparte al total a pagar.
        </p>
      </div>
      <Dialog description="Anticipos emitidos a este cliente con importe pendiente de descontar." onClose={() => setDialogOpen(false)} open={dialogOpen} size="sm" title="Descontar anticipo">
        {loadError ? <p className="font-mono text-xs text-danger-text" role="alert">{loadError}</p> : null}
        {!loadError && advances === null ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}
        {advances && advances.length === 0 ? <p className="text-sm text-muted-foreground">Este cliente no tiene anticipos pendientes de descontar.</p> : null}
        {advances && advances.length > 0 ? (
          <ul className="space-y-1" data-testid="invoice-advance-list">
            {advances.flatMap((advance) => advance.pending.map((pending) => (
              <li key={`${advance.id}-${pending.taxKey}`}>
                <button
                  className="flex w-full items-center justify-between gap-3 rounded-control border border-window-shadow px-2 py-2 text-left hover:bg-window-panel pointer-coarse:min-h-11"
                  onClick={() => add(advance, pending)}
                  type="button"
                >
                  <span className="font-mono text-sm font-bold">{advance.number}</span>
                  <span className="text-right font-mono text-sm tabular-nums">{money(pending.amount)} <span className="text-xs text-muted-foreground">base pendiente</span></span>
                </button>
              </li>
            )))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button onClick={() => setDialogOpen(false)} type="button" variant="outline">Cerrar</Button>
        </DialogFooter>
      </Dialog>
    </details>
  );
}
