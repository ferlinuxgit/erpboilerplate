"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { sequenceTypeHelp } from "@/components/treasury/direct-debit-status";
import { Button } from "@/components/ui/button";
import { AccessibleField, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { EmptyState, InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIban } from "@/lib/bank-import/iban";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney, parseDecimalInput } from "@/lib/format";

export type CollectableInvoice = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  outstanding: number;
  dueDate: Date | string | null;
  href: string;
  pendingRemittance: string | null;
  mandate: { id: string; reference: string; iban: string; sequenceType: string; problem: string | null } | null;
};

type Account = { id: string; bankName: string; iban: string };
type Line = { selected: boolean; amount: string };

/** Nueva remesa de adeudos SEPA: facturas de clientes con mandato → fichero pain.008 para el banco. */
export function DirectDebitForm({ accounts, currencyCode, earliestDate, invoices, ready }: { accounts: Account[]; currencyCode: string; earliestDate: string; invoices: CollectableInvoice[]; ready: boolean }) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? "");
  const [collectionDate, setCollectionDate] = useState(earliestDate);
  const [lines, setLines] = useState<Record<string, Line>>(() =>
    Object.fromEntries(invoices.map((invoice) => [invoice.id, { selected: false, amount: invoice.outstanding.toFixed(2).replace(".", ",") }])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = (invoice: CollectableInvoice) => Boolean(invoice.mandate && !invoice.mandate.problem && !invoice.pendingRemittance);
  const selected = invoices.filter((invoice) => lines[invoice.id]?.selected);
  const total = selected.reduce((sum, invoice) => sum + (parseDecimalInput(lines[invoice.id].amount) ?? 0), 0);
  const withoutMandate = invoices.filter((invoice) => !invoice.mandate).length;

  function update(id: string, patch: Partial<Line>) {
    setLines((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function submit() {
    setError(null);
    const problems = selected
      .filter((invoice) => {
        const amount = parseDecimalInput(lines[invoice.id].amount) ?? 0;
        return amount <= 0 || Math.round(amount * 100) > Math.round(invoice.outstanding * 100);
      })
      .map((invoice) => `${invoice.number}: el importe debe estar entre 0,01 y lo pendiente.`);
    if (collectionDate < earliestDate) problems.push(`La fecha de cobro debe ser como pronto el ${formatDate(earliestDate)}.`);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/sepa/direct-debits", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          bankAccountId,
          collectionDate,
          items: selected.map((invoice) => ({ invoiceId: invoice.id, amount: parseDecimalInput(lines[invoice.id].amount) ?? 0 })),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo generar la remesa de cobros."));
      const created = (await response.json()) as { id: string; number: string };
      toast.success(`Remesa ${created.number} generada.`, { description: "Descarga el fichero y súbelo a tu banca online." });
      router.push(`/treasury/direct-debits/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo generar la remesa de cobros.");
    } finally {
      setSaving(false);
    }
  }

  if (invoices.length === 0) {
    return <EmptyState title="No hay facturas pendientes de cobro" description="Cuando emitas facturas a clientes domiciliados podrás cobrarlas aquí en una sola remesa." />;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <AccessibleField helperText="Cuenta en la que el banco abonará los recibos." id="direct-debit-account" label="Cuenta de abono" required>
          <Select onChange={(event) => setBankAccountId(event.target.value)} value={bankAccountId}>
            {accounts.map((entry) => <option key={entry.id} value={entry.id}>{entry.bankName} · {formatIban(entry.iban)}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField helperText="Día en que se cargará a tus clientes. Súbelo al banco al menos un día hábil antes (mejor 2-3 si es el primer recibo de un mandato)." id="direct-debit-date" label="Fecha de cobro" required>
          <Input min={earliestDate} onChange={(event) => setCollectionDate(event.target.value)} type="date" value={collectionDate} />
        </AccessibleField>
      </div>
      {withoutMandate > 0 ? (
        <p className="text-xs text-muted-foreground">{withoutMandate} {withoutMandate === 1 ? "factura es de un cliente" : "facturas son de clientes"} sin mandato SEPA: añádelo desde la ficha del cliente («Domiciliación bancaria») para poder incluirlas.</p>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"><span className="sr-only">Incluir</span></TableHead>
              <TableHead>Factura</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead className="text-right">Pendiente</TableHead>
              <TableHead>Importe a cobrar</TableHead>
              <TableHead>Mandato</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => {
              const line = lines[invoice.id];
              const canInclude = eligible(invoice);
              return (
                <TableRow data-testid="direct-debit-invoice-row" key={invoice.id}>
                  <TableCell>
                    <input aria-label={`Incluir ${invoice.number}`} checked={line.selected} disabled={!canInclude} onChange={(event) => update(invoice.id, { selected: event.target.checked })} type="checkbox" />
                  </TableCell>
                  <TableCell>
                    <Link className="font-medium text-primary hover:underline" href={invoice.href}>{invoice.number}</Link>
                    <p className="text-xs text-muted-foreground">{invoice.customerName}</p>
                    {invoice.pendingRemittance ? <p className="text-xs text-warning">Ya está en la remesa {invoice.pendingRemittance}</p> : null}
                  </TableCell>
                  <TableCell className="text-sm">{invoice.dueDate ? formatDate(invoice.dueDate) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(invoice.outstanding, currencyCode)}</TableCell>
                  <TableCell className="w-36">
                    <label className="sr-only" htmlFor={`direct-debit-amount-${invoice.id}`}>Importe a cobrar de {invoice.number}</label>
                    <MoneyInput disabled={!line.selected} id={`direct-debit-amount-${invoice.id}`} onChange={(event) => update(invoice.id, { amount: event.target.value })} value={line.amount} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {invoice.mandate ? (
                      <>
                        <span className="block font-mono">{invoice.mandate.reference}</span>
                        <span className="block text-muted-foreground">{formatIban(invoice.mandate.iban)} · {sequenceTypeHelp[invoice.mandate.sequenceType] ?? invoice.mandate.sequenceType}</span>
                        {invoice.mandate.problem ? <span className="block text-destructive">{invoice.mandate.problem}</span> : null}
                      </>
                    ) : (
                      <Link className="text-primary underline" href={`/customers/${invoice.customerId}`}>Sin mandato · añadir</Link>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p aria-live="polite" className="font-mono text-sm">{selected.length} {selected.length === 1 ? "recibo" : "recibos"} · total {formatMoney(total, currencyCode)}</p>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="direct-debit-generate" disabled={!ready || saving || selected.length === 0 || !bankAccountId} onClick={() => void submit()} type="button">{saving ? "Generando…" : "Generar fichero de recibos"}</Button>
        <p className="text-xs text-muted-foreground">Todavía no se registra ningún cobro: lo harás al marcar la remesa como cobrada.</p>
      </div>
    </div>
  );
}
