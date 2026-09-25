"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AccountPicker } from "@/components/ui/account-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { AccessibleField } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { normalizeText, toCents, validateAllocations, type AllocationInput } from "@/lib/bank-import/allocations";
import { formatDate, formatMoney, parseDecimalInput } from "@/lib/format";

export type InvoiceOption = {
  id: string;
  kind: "customer" | "supplier";
  number: string;
  altNumber?: string | null;
  partnerName: string;
  outstanding: number;
  dueDate: Date | string | null;
  href: string;
};

export type AccountOption = { id: string; code: string; name: string };

type Movement = { id: string; amount: number; description: string };

type Props = {
  open: boolean;
  onClose: () => void;
  movement: Movement;
  invoices: InvoiceOption[];
  accounts: AccountOption[];
  currencyCode: string;
  onSubmit: (allocations: AllocationInput[]) => Promise<void>;
};

/**
 * Reparto de un movimiento entre varias facturas (cobro/pago parcial permitido) y, si hace falta,
 * una diferencia a una cuenta (p. ej. la comisión que el banco descontó de un cobro).
 */
export function SplitAllocationDialog({ accounts, currencyCode, invoices, movement, onClose, onSubmit, open }: Props) {
  const [query, setQuery] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [differenceAccountId, setDifferenceAccountId] = useState("");
  const [differenceAmount, setDifferenceAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDeposit = movement.amount >= 0;
  const target = Math.abs(movement.amount);

  const visible = useMemo(() => {
    const needle = normalizeText(query);
    const matching = invoices.filter((invoice) => {
      if (!needle) return true;
      return normalizeText(`${invoice.number} ${invoice.altNumber ?? ""} ${invoice.partnerName} ${invoice.outstanding.toFixed(2)}`).includes(needle);
    });
    // Seleccionadas arriba, luego el resto.
    return [...matching.filter((invoice) => invoice.id in amounts), ...matching.filter((invoice) => !(invoice.id in amounts))].slice(0, 60);
  }, [amounts, invoices, query]);

  const allocations: AllocationInput[] = [
    ...Object.entries(amounts).map(([id, raw]) => ({
      type: (isDeposit ? "CUSTOMER_INVOICE" : "SUPPLIER_INVOICE") as AllocationInput["type"],
      targetId: id,
      amount: parseDecimalInput(raw, { maximumFractionDigits: 2 }) ?? 0,
    })),
    ...(differenceAccountId && parseDecimalInput(differenceAmount) !== null
      ? [{ type: "ACCOUNT" as const, targetId: differenceAccountId, amount: parseDecimalInput(differenceAmount, { maximumFractionDigits: 2 }) ?? 0 }]
      : []),
  ];
  const assignedCents = allocations.reduce((sum, allocation) => sum + toCents(allocation.amount), 0);
  const remaining = (toCents(target) - assignedCents) / 100;
  const errors = allocations.length ? validateAllocations(movement.amount, allocations) : [];

  function toggle(invoice: InvoiceOption) {
    setAmounts((current) => {
      const next = { ...current };
      if (invoice.id in next) {
        delete next[invoice.id];
        return next;
      }
      const used = Object.values(next).reduce((sum, raw) => sum + toCents(parseDecimalInput(raw) ?? 0), 0);
      const left = Math.max(toCents(target) - used, 0);
      const amount = Math.min(toCents(invoice.outstanding), left || toCents(invoice.outstanding)) / 100;
      next[invoice.id] = amount.toFixed(2).replace(".", ",");
      return next;
    });
  }

  function putRemainderInDifference() {
    setDifferenceAmount(((Math.round(remaining * 100) + toCents(parseDecimalInput(differenceAmount) ?? 0)) / 100).toFixed(2).replace(".", ","));
  }

  async function submit() {
    setError(null);
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setSaving(true);
    try {
      await onSubmit(allocations);
      setAmounts({});
      setDifferenceAccountId("");
      setDifferenceAmount("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo conciliar el movimiento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      description={`${movement.description} · ${formatMoney(movement.amount, currencyCode)}. Marca las ${isDeposit ? "facturas que te pagan" : "facturas que pagas"} con este movimiento; puedes cobrar/pagar una parte de cada una. Se registrará un ${isDeposit ? "cobro" : "pago"} por factura con la fecha del movimiento.`}
      onClose={() => { if (!saving) onClose(); }}
      open={open}
      size="xl"
      title={isDeposit ? "Repartir el ingreso entre facturas" : "Repartir el cargo entre facturas"}
    >
      <div className="space-y-3">
        <AccessibleField id={`split-search-${movement.id}`} label="Buscar factura" helperText="Por número, cliente/proveedor o importe.">
          <Input autoComplete="off" onChange={(event) => setQuery(event.target.value)} value={query} />
        </AccessibleField>
        <div className="max-h-72 overflow-y-auto border border-window-dark-shadow">
          {visible.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No hay {isDeposit ? "facturas de clientes" : "facturas de proveedores"} pendientes{query ? " que coincidan con la búsqueda" : ""}.</p>
          ) : (
            <ul className="divide-y divide-window-shadow">
              {visible.map((invoice) => {
                const selected = invoice.id in amounts;
                const inputId = `split-${movement.id}-${invoice.id}`;
                return (
                  <li className="flex flex-wrap items-center gap-2 p-2" key={invoice.id}>
                    <input aria-label={`Incluir la factura ${invoice.number}`} checked={selected} onChange={() => toggle(invoice)} type="checkbox" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        <Link className="text-primary hover:underline" href={invoice.href} target="_blank">{invoice.number}</Link>
                        {invoice.altNumber ? <span className="text-muted-foreground"> ({invoice.altNumber})</span> : null} · {invoice.partnerName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Pendiente {formatMoney(invoice.outstanding, currencyCode)}{invoice.dueDate ? ` · vence ${formatDate(invoice.dueDate)}` : " · sin vencimiento"}
                      </p>
                    </div>
                    {selected ? (
                      <div className="w-36">
                        <label className="sr-only" htmlFor={inputId}>Importe aplicado a {invoice.number}</label>
                        <MoneyInput id={inputId} onChange={(event) => setAmounts((current) => ({ ...current, [invoice.id]: event.target.value }))} value={amounts[invoice.id]} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <fieldset className="grid gap-2 border border-window-dark-shadow p-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <legend className="px-1 text-xs font-bold">Diferencia a una cuenta (opcional)</legend>
          <AccessibleField helperText="P. ej. 626 si el banco descontó una comisión. Negativo si resta al movimiento." id={`split-diff-account-${movement.id}`} label="Cuenta">
            <AccountPicker accounts={accounts} id={`split-diff-account-${movement.id}`} onChange={(accountId) => setDifferenceAccountId(accountId)} recentKey="bank-assign" value={differenceAccountId} />
          </AccessibleField>
          <AccessibleField id={`split-diff-amount-${movement.id}`} label="Importe">
            <MoneyInput id={`split-diff-amount-${movement.id}`} onChange={(event) => setDifferenceAmount(event.target.value)} value={differenceAmount} />
          </AccessibleField>
          <Button disabled={!differenceAccountId || Math.round(remaining * 100) === 0} onClick={putRemainderInDifference} size="sm" type="button" variant="outline">Poner lo que falta</Button>
        </fieldset>

        <p aria-live="polite" className="font-mono text-sm" data-testid="split-remaining">
          Asignado {formatMoney(assignedCents / 100, currencyCode)} de {formatMoney(target, currencyCode)} ·{" "}
          {Math.round(remaining * 100) === 0 ? <strong className="text-success">cuadra</strong> : <strong className="text-warning">{remaining > 0 ? "faltan" : "sobran"} {formatMoney(Math.abs(remaining), currencyCode)}</strong>}
        </p>
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </div>
      <DialogFooter>
        <Button disabled={saving} onClick={onClose} type="button" variant="outline">Cancelar</Button>
        <Button disabled={saving || allocations.length === 0 || errors.length > 0} onClick={() => void submit()} type="button">{saving ? "Conciliando…" : "Conciliar reparto"}</Button>
      </DialogFooter>
    </Dialog>
  );
}
