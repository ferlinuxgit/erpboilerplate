"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { EmptyState, InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { checkIban, formatIban } from "@/lib/bank-import/iban";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDate, formatMoney, parseDecimalInput } from "@/lib/format";

export type RemittableInvoice = {
  id: string;
  number: string;
  altNumber?: string | null;
  partnerName: string;
  outstanding: number;
  dueDate: Date | string | null;
  href: string;
  pendingRemittance: string | null;
  iban: string | null;
  bic: string | null;
};

type Account = { id: string; bankName: string; iban: string; bic: string | null };
type Line = { selected: boolean; amount: string; iban: string; bic: string };

/** Siguiente día hábil (lunes a viernes) en formato AAAA-MM-DD. */
function nextBusinessDay() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Nueva remesa SEPA: facturas pendientes de proveedores → fichero pain.001 para la banca online. */
export function RemittanceForm({ accounts, currencyCode, invoices }: { accounts: Account[]; currencyCode: string; invoices: RemittableInvoice[] }) {
  const router = useRouter();
  const [bankAccountId, setBankAccountId] = useState(accounts.length === 1 ? accounts[0].id : accounts[0]?.id ?? "");
  const [executionDate, setExecutionDate] = useState(nextBusinessDay);
  const [lines, setLines] = useState<Record<string, Line>>(() =>
    Object.fromEntries(invoices.map((invoice) => [invoice.id, { selected: false, amount: invoice.outstanding.toFixed(2).replace(".", ","), iban: invoice.iban ? formatIban(invoice.iban) : "", bic: invoice.bic ?? "" }])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = accounts.find((entry) => entry.id === bankAccountId);
  const debtorIban = account ? checkIban(account.iban) : null;

  const selected = invoices.filter((invoice) => lines[invoice.id]?.selected);
  const total = selected.reduce((sum, invoice) => sum + (parseDecimalInput(lines[invoice.id].amount) ?? 0), 0);
  const problems = (() => {
    const list: string[] = [];
    if (debtorIban && !debtorIban.valid) list.push(`El IBAN de la cuenta de cargo no es válido: ${debtorIban.reason} Corrígelo en la ficha de la cuenta.`);
    for (const invoice of selected) {
      const line = lines[invoice.id];
      const iban = checkIban(line.iban);
      if (!iban.valid) list.push(`${invoice.number} (${invoice.partnerName}): ${iban.reason}`);
      const amount = parseDecimalInput(line.amount) ?? 0;
      if (amount <= 0 || Math.round(amount * 100) > Math.round(invoice.outstanding * 100)) list.push(`${invoice.number}: el importe debe estar entre 0,01 y lo pendiente.`);
    }
    return list;
  })();

  function update(id: string, patch: Partial<Line>) {
    setLines((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  }

  async function submit() {
    setError(null);
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/sepa/remittances", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: JSON.stringify({
          bankAccountId,
          executionDate,
          items: selected.map((invoice) => ({
            supplierInvoiceId: invoice.id,
            amount: parseDecimalInput(lines[invoice.id].amount) ?? 0,
            iban: lines[invoice.id].iban,
            bic: lines[invoice.id].bic.trim() || null,
          })),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo generar la remesa."));
      const created = (await response.json()) as { id: string; number: string };
      toast.success(`Remesa ${created.number} generada.`, { description: "Descarga el fichero y súbelo a tu banca online." });
      router.push(`/treasury/remittances/${created.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo generar la remesa.");
    } finally {
      setSaving(false);
    }
  }

  if (invoices.length === 0) {
    return <EmptyState title="No hay facturas de proveedor pendientes" description="Cuando registres facturas de proveedores sin pagar, podrás pagarlas aquí en una sola remesa." />;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <AccessibleField helperText={debtorIban && !debtorIban.valid ? `IBAN no válido: ${debtorIban.reason}` : "Cuenta desde la que se pagará."} id="remittance-account" label="Cuenta de cargo" required>
          <Select onChange={(event) => setBankAccountId(event.target.value)} value={bankAccountId}>
            {accounts.map((entry) => <option key={entry.id} value={entry.id}>{entry.bankName} · {entry.iban}</option>)}
          </Select>
        </AccessibleField>
        <AccessibleField helperText="Día en que el banco hará las transferencias." id="remittance-date" label="Fecha de ejecución" required>
          <Input min={new Date().toISOString().slice(0, 10)} onChange={(event) => setExecutionDate(event.target.value)} type="date" value={executionDate} />
        </AccessibleField>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"><span className="sr-only">Incluir</span></TableHead>
              <TableHead>Factura</TableHead>
              <TableHead>Vence</TableHead>
              <TableHead className="text-right">Pendiente</TableHead>
              <TableHead>Importe a pagar</TableHead>
              <TableHead>IBAN del proveedor</TableHead>
              <TableHead>BIC (opcional)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((invoice) => {
              const line = lines[invoice.id];
              const iban = line.iban ? checkIban(line.iban) : null;
              return (
                <TableRow data-testid="remittance-invoice-row" key={invoice.id}>
                  <TableCell>
                    <input aria-label={`Incluir ${invoice.number}`} checked={line.selected} disabled={Boolean(invoice.pendingRemittance)} onChange={(event) => update(invoice.id, { selected: event.target.checked })} type="checkbox" />
                  </TableCell>
                  <TableCell>
                    <Link className="font-medium text-primary hover:underline" href={invoice.href}>{invoice.number}</Link>
                    <p className="text-xs text-muted-foreground">{invoice.partnerName}{invoice.altNumber ? ` · ${invoice.altNumber}` : ""}</p>
                    {invoice.pendingRemittance ? <p className="text-xs text-warning">Ya está en la remesa {invoice.pendingRemittance}</p> : null}
                  </TableCell>
                  <TableCell className="text-sm">{invoice.dueDate ? formatDate(invoice.dueDate) : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(invoice.outstanding, currencyCode)}</TableCell>
                  <TableCell className="w-36">
                    <label className="sr-only" htmlFor={`remittance-amount-${invoice.id}`}>Importe a pagar de {invoice.number}</label>
                    <MoneyInput disabled={!line.selected} id={`remittance-amount-${invoice.id}`} onChange={(event) => update(invoice.id, { amount: event.target.value })} value={line.amount} />
                  </TableCell>
                  <TableCell className="min-w-64">
                    <label className="sr-only" htmlFor={`remittance-iban-${invoice.id}`}>IBAN de {invoice.partnerName}</label>
                    <Input aria-invalid={line.selected && iban !== null && !iban.valid ? true : undefined} disabled={!line.selected} id={`remittance-iban-${invoice.id}`} onChange={(event) => update(invoice.id, { iban: event.target.value.toUpperCase() })} placeholder="ES00 0000 0000 00 0000000000" value={line.iban} />
                    {line.selected && iban && !iban.valid ? <p className="text-xs text-destructive">{iban.reason}</p> : null}
                  </TableCell>
                  <TableCell className="w-32">
                    <label className="sr-only" htmlFor={`remittance-bic-${invoice.id}`}>BIC de {invoice.partnerName}</label>
                    <Input disabled={!line.selected} id={`remittance-bic-${invoice.id}`} maxLength={11} onChange={(event) => update(invoice.id, { bic: event.target.value.toUpperCase() })} value={line.bic} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="font-mono text-sm" aria-live="polite">{selected.length} {selected.length === 1 ? "pago" : "pagos"} · total {formatMoney(total, currencyCode)}</p>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="remittance-generate" disabled={saving || selected.length === 0 || !bankAccountId} onClick={() => void submit()} type="button">{saving ? "Generando…" : "Generar fichero SEPA"}</Button>
        <p className="text-xs text-muted-foreground">Todavía no se registra ningún pago: lo harás al confirmar que el banco ha enviado la remesa. El IBAN de cada proveedor se recuerda para la próxima vez.</p>
      </div>
    </div>
  );
}
