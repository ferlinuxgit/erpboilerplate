import Link from "next/link";
import { notFound } from "next/navigation";

import { DirectDebitActions, DirectDebitReturnButton } from "@/components/treasury/direct-debit-actions";
import { directDebitItemStatusLabels, directDebitItemStatusTone, directDebitStatusLabels, directDebitStatusTone, sequenceTypeHelp } from "@/components/treasury/direct-debit-status";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIban } from "@/lib/bank-import/iban";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getDirectDebitRemittance } from "@/server/sepa/direct-debits";
import { listAssignableAccounts } from "@/server/treasury/workbench";

export default async function DirectDebitRemittanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("treasury.read");
  const { id } = await params;
  const remittance = await getDirectDebitRemittance(ctx.company.id, id);
  if (!remittance) notFound();
  const canWrite = can(ctx.membership.role, "treasury.write");
  const hasReturnActions = canWrite && remittance.status === "COLLECTED";
  const feeAccounts = hasReturnActions ? await listAssignableAccounts(ctx.company.id) : [];
  const currency = ctx.company.baseCurrencyCode;
  const returned = remittance.items.filter((item) => item.status === "RETURNED");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería · Remesa de cobros SEPA"
        title={`Remesa ${remittance.number}`}
        description={`${remittance.bankName} · ${formatIban(remittance.iban)} · acreedor ${remittance.creditorId}`}
        backHref="/treasury/direct-debits"
        backLabel="Volver a remesas de cobros"
        meta={<StatusBadge tone={directDebitStatusTone(remittance.status)}>{directDebitStatusLabels[remittance.status] ?? remittance.status}</StatusBadge>}
        actions={canWrite ? <DirectDebitActions id={remittance.id} number={remittance.number} status={remittance.status} /> : null}
      />
      {remittance.status === "GENERATED" ? (
        <InlineAlert tone="info" title="Siguientes pasos">
          1) Descarga el fichero de recibos y súbelo en tu banca online (apartado «remesas de recibos», «adeudos SEPA» o «cuaderno 19»). 2) Cuando el banco abone los recibos, pulsa «Remesa cobrada» para registrar los cobros. 3) Cuando veas el abono en el extracto, concílialo con la propuesta «Remesa SEPA». Si un cliente devuelve su recibo, márcalo como «Devuelto».
        </InlineAlert>
      ) : null}
      {returned.some((item) => !item.returnBankTransactionId) ? (
        <InlineAlert tone="warning" title="Devoluciones sin cargo vinculado">
          Cuando el cargo de la devolución llegue al extracto, pulsa «Vincular cargo» en el recibo para conciliarlo (no lo asignes a una cuenta desde la mesa de conciliación).
        </InlineAlert>
      ) : null}
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Total" value={formatMoney(remittance.totalAmount, currency)} helper={`${remittance.itemCount} recibos${returned.length ? ` · ${returned.length} devueltos` : ""}`} tone={returned.length ? "warning" : undefined} />
        <MetricCard label="Fecha de cobro" value={formatDate(remittance.collectionDate)} helper={`Generada el ${formatDateTime(remittance.createdAt)}`} />
        <MetricCard label="Cobrada" value={remittance.collectedAt ? formatDate(remittance.collectedAt) : "No"} helper={remittance.collectedAt ? "Cobros registrados" : "Sin cobros registrados todavía"} tone={remittance.collectedAt ? "success" : "warning"} />
      </section>
      <PageSection title="Recibos incluidos" description="Un recibo por factura.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Factura</TableHead>
                <TableHead>Mandato · IBAN</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead>Estado</TableHead>
                {hasReturnActions ? <TableHead><span className="sr-only">Acciones</span></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {remittance.items.map((item) => (
                <TableRow data-testid="direct-debit-item-row" key={item.id}>
                  <TableCell><Link className="hover:underline" href={`/customers/${item.customerId}`}>{item.debtorName}</Link></TableCell>
                  <TableCell><Link className="text-primary hover:underline" href={`/invoices/${item.invoiceId}`}>{item.invoiceNumber}</Link></TableCell>
                  <TableCell className="font-mono text-xs">{item.mandateReference}<span className="block">{formatIban(item.debtorIban)}</span></TableCell>
                  <TableCell className="text-xs">{sequenceTypeHelp[item.sequenceType] ?? item.sequenceType}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(item.amount, currency)}</TableCell>
                  <TableCell>
                    <StatusBadge tone={directDebitItemStatusTone(item.status)}>{directDebitItemStatusLabels[item.status] ?? item.status}</StatusBadge>
                    {item.status === "RETURNED" ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.returnedAt ? formatDate(item.returnedAt) : ""}{item.returnReason ? ` · ${item.returnReason}` : ""}
                        {item.returnBankTransactionId ? ` · cargo conciliado${item.returnFeeAmount && Number(item.returnFeeAmount) > 0 ? ` (comisión ${formatMoney(item.returnFeeAmount, currency)})` : ""}` : " · cargo sin vincular"}
                      </span>
                    ) : null}
                  </TableCell>
                  {hasReturnActions ? (
                    <TableCell>
                      {item.status === "COLLECTED" ? <DirectDebitReturnButton currencyCode={currency} feeAccounts={feeAccounts} item={item} mode="return" /> : null}
                      {item.status === "RETURNED" && !item.returnBankTransactionId ? <DirectDebitReturnButton currencyCode={currency} feeAccounts={feeAccounts} item={item} mode="link" /> : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PageSection>
    </PageShell>
  );
}
