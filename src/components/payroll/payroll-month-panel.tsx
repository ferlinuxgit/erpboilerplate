"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AccessibleField, errorMessage, readApiError } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/number-input";
import { InlineAlert } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCsrfHeader } from "@/lib/csrf-client";
import { formatDecimalInput, formatMoney, parseDecimalInput } from "@/lib/format";
import type { PayrollPeriodSummary, PayrollSlipRow } from "@/server/payroll/service";

type PayrollMonthPanelProps = {
  period: string;
  slips: PayrollSlipRow[];
  summary: PayrollPeriodSummary;
  banks: Array<{ id: string; bankName: string; iban: string | null }>;
  canWrite: boolean;
  currencyCode: string;
  today: string;
};

const formatIso = (iso: string) => iso.split("-").reverse().join("/");

/** Nóminas de un mes: contabilizar, descontabilizar, eliminar y registrar los pagos (nóminas y seguros sociales). */
export function PayrollMonthPanel({ period, slips, summary, banks, canWrite, currencyCode, today }: PayrollMonthPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(today < `${period}-01` ? `${period}-01` : today);
  const [bankAccountId, setBankAccountId] = useState(banks[0]?.id ?? "");
  const [postEntry, setPostEntry] = useState(true);
  const [socialSecurityAmount, setSocialSecurityAmount] = useState("");
  const money = (value: string | number) => formatMoney(value, currencyCode);
  const cents = (value: number) => formatMoney(value / 100, currencyCode);

  async function call(key: string, url: string, method: string, body: unknown, success: string) {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...getCsrfHeader() },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await readApiError(response, "No se pudo completar la operación."));
      toast.success(success);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught, "No se pudo completar la operación."));
    } finally {
      setBusy(null);
    }
  }

  function pay(kind: "salaries" | "socialSecurity") {
    const amount = kind === "socialSecurity" ? parseDecimalInput(socialSecurityAmount, { maximumFractionDigits: 2 }) : null;
    void call(
      `pay-${kind}`,
      "/api/payroll/payments",
      "POST",
      { kind, period, paymentDate, bankAccountId: bankAccountId || null, postEntry, ...(amount ? { amount } : {}) },
      kind === "salaries" ? "Pago de nóminas registrado." : "Pago de seguros sociales registrado.",
    );
  }

  return (
    <div className="space-y-3">
      {error ? <InlineAlert role="alert" tone="danger">{error}</InlineAlert> : null}

      <TableContainer>
        <Table className="min-w-[68rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Trabajador</TableHead>
              <TableHead>Concepto</TableHead>
              <TableHead className="text-right">Bruto</TableHead>
              <TableHead className="text-right">IRPF</TableHead>
              <TableHead className="text-right">SS trabajador</TableHead>
              <TableHead className="text-right">SS empresa</TableHead>
              <TableHead className="text-right">Líquido</TableHead>
              <TableHead>Estado</TableHead>
              {canWrite ? <TableHead className="text-right">Acciones</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {slips.map((slip) => (
              <TableRow key={slip.id}>
                <TableCell className="font-medium">
                  {slip.employeeName}
                  {slip.recipientKind === "director" ? <span className="ml-1 text-xs text-muted-foreground">(administrador)</span> : null}
                </TableCell>
                <TableCell>{slip.concept}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono">{money(slip.grossAmount)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono">{money(Number(slip.withholdingAmount) + Number(slip.inKindWithholdingAmount))}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono">{money(slip.employeeSocialSecurity)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono">{money(slip.employerSocialSecurity)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono">{money(slip.netAmount)}</TableCell>
                <TableCell>
                  {slip.status === "draft" ? (
                    <StatusBadge tone="warning">Borrador</StatusBadge>
                  ) : slip.paymentDate ? (
                    <StatusBadge tone="success">Pagada el {formatIso(slip.paymentDate)}</StatusBadge>
                  ) : (
                    <StatusBadge tone="info">Contabilizada</StatusBadge>
                  )}
                  {slip.journalEntryId ? <Link className="ml-1 text-xs text-link hover:underline" href={`/accounting/entries/${slip.journalEntryId}`}>Ver asiento</Link> : null}
                  <a className="ml-1 text-xs text-link hover:underline" href={`/api/payroll/slips/${slip.id}/receipt`} rel="noreferrer" target="_blank">Recibo (PDF)</a>
                </TableCell>
                {canWrite ? (
                  <TableCell className="whitespace-nowrap text-right">
                    {slip.status === "draft" ? (
                      <>
                        <Link className="mr-2 text-sm text-link hover:underline" href={`/payroll/slips/${slip.id}`}>Editar</Link>
                        <Button disabled={busy !== null} onClick={() => void call(`post-${slip.id}`, `/api/payroll/slips/${slip.id}/post`, "POST", undefined, "Nómina contabilizada.")} size="xs" type="button">
                          Contabilizar
                        </Button>
                        <Button className="ml-1" disabled={busy !== null} onClick={() => void call(`delete-${slip.id}`, `/api/payroll/slips/${slip.id}`, "DELETE", undefined, "Nómina eliminada.")} size="xs" type="button" variant="outline">
                          Eliminar
                        </Button>
                      </>
                    ) : slip.paymentDate ? null : (
                      <Button disabled={busy !== null} onClick={() => void call(`unpost-${slip.id}`, `/api/payroll/slips/${slip.id}/post`, "DELETE", undefined, "Asiento anulado: la nómina vuelve a borrador.")} size="xs" type="button" variant="outline">
                        Descontabilizar
                      </Button>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>Total de {summary.label}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono">{cents(summary.grossCents)}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono">{cents(summary.withholdingCents)}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono">{cents(summary.employeeSocialSecurityCents)}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono">{cents(summary.employerSocialSecurityCents)}</TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono">{cents(summary.netCents)}</TableCell>
              <TableCell colSpan={canWrite ? 2 : 1}>
                {canWrite && summary.drafts > 0 ? (
                  <Button disabled={busy !== null} onClick={() => void call("post-all", "/api/payroll/periods/post", "POST", { period }, "Nóminas del mes contabilizadas.")} size="sm" type="button">
                    Contabilizar las {summary.drafts} en borrador
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>

      {canWrite && (summary.pendingSalariesCents > 0 || summary.pendingSocialSecurityCents > 0) ? (
        <div className="space-y-2 rounded-surface border p-3">
          <p className="font-mono text-sm font-bold">Registrar pagos del mes</p>
          <div className="grid gap-3 md:grid-cols-6">
            <AccessibleField className="md:col-span-1" id="payroll-payment-date" label="Fecha de pago" required>
              <Input min={`${period}-01`} onChange={(event) => setPaymentDate(event.target.value)} required type="date" value={paymentDate} />
            </AccessibleField>
            <AccessibleField className="md:col-span-2" helperText="Sin cuenta se usa la de bancos por defecto (572)." id="payroll-payment-bank" label="Cuenta bancaria">
              <Select onChange={(event) => setBankAccountId(event.target.value)} value={bankAccountId}>
                <option value="">Bancos por defecto</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>{bank.bankName}{bank.iban ? ` · ${bank.iban.slice(-4)}` : ""}</option>
                ))}
              </Select>
            </AccessibleField>
            <AccessibleField className="md:col-span-1" helperText={`Pendiente: ${cents(summary.pendingSocialSecurityCents)}.`} id="payroll-ss-amount" label="Seguros sociales">
              <MoneyInput onChange={(event) => setSocialSecurityAmount(event.target.value)} placeholder={formatDecimalInput(summary.pendingSocialSecurityCents / 100, { minimumFractionDigits: 2 })} value={socialSecurityAmount} />
            </AccessibleField>
            <div className="flex flex-wrap items-end gap-2 md:col-span-2">
              <Button disabled={busy !== null || summary.pendingSalariesCents === 0 || !paymentDate} onClick={() => pay("salaries")} type="button">
                Pagar nóminas ({cents(summary.pendingSalariesCents)})
              </Button>
              <Button disabled={busy !== null || summary.pendingSocialSecurityCents === 0 || !paymentDate} onClick={() => pay("socialSecurity")} type="button" variant="outline">
                Pagar seguros sociales
              </Button>
            </div>
          </div>
          <label className="flex w-fit items-center gap-2 text-sm">
            <input checked={postEntry} onChange={(event) => setPostEntry(event.target.checked)} type="checkbox" />
            Crear el asiento del pago (465 o 476 a banco)
          </label>
          <p className="text-xs text-muted-foreground">
            Desmárcalo si contabilizas el cargo desde el movimiento bancario en Tesorería (asignándolo a la cuenta 465 o 476): así no se duplica el asiento y la nómina queda igualmente marcada como pagada.
          </p>
        </div>
      ) : null}

      {summary.payments.length > 0 ? (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pago</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Banco</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                {canWrite ? <TableHead className="text-right">Acciones</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{payment.kind === "salaries" ? "Nóminas (465)" : "Seguros sociales (476)"}{payment.hasEntry ? "" : " · sin asiento"}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatIso(payment.paymentDate)}</TableCell>
                  <TableCell>{payment.bankName ?? "Bancos por defecto"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{cents(payment.amountCents)}</TableCell>
                  {canWrite ? (
                    <TableCell className="text-right">
                      <Button disabled={busy !== null} onClick={() => void call(`unpay-${payment.id}`, `/api/payroll/payments/${payment.id}`, "DELETE", undefined, "Pago anulado.")} size="xs" type="button" variant="outline">
                        Anular pago
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </div>
  );
}
