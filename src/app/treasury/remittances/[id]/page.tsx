import Link from "next/link";
import { notFound } from "next/navigation";

import { RemittanceActions } from "@/components/treasury/remittance-actions";
import { remittanceStatusLabels, remittanceStatusTone } from "@/components/treasury/remittance-status";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatIban } from "@/lib/bank-import/iban";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getRemittance } from "@/server/sepa/service";

export default async function RemittanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("treasury.read");
  const { id } = await params;
  const remittance = await getRemittance(ctx.company.id, id);
  if (!remittance) notFound();
  const currency = ctx.company.baseCurrencyCode;
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería · Remesa SEPA"
        title={`Remesa ${remittance.number}`}
        description={`${remittance.bankName} · ${formatIban(remittance.iban)}`}
        backHref="/treasury/remittances"
        backLabel="Volver a remesas"
        meta={<StatusBadge tone={remittanceStatusTone(remittance.status)}>{remittanceStatusLabels[remittance.status] ?? remittance.status}</StatusBadge>}
        actions={can(ctx.membership.role, "treasury.write") ? <RemittanceActions id={remittance.id} number={remittance.number} status={remittance.status} /> : null}
      />
      {remittance.status === "GENERATED" ? (
        <InlineAlert tone="info" title="Siguientes pasos">
          1) Descarga el fichero SEPA y súbelo en tu banca online (apartado «ficheros», «remesas» o «transferencias masivas»). 2) Cuando el banco lo acepte, pulsa «Remesa enviada / cargada» para registrar los pagos. 3) Cuando veas el cargo en el extracto, concílialo con la propuesta «Remesa SEPA».
        </InlineAlert>
      ) : null}
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Total" value={formatMoney(remittance.totalAmount, currency)} helper={`${remittance.itemCount} pagos`} />
        <MetricCard label="Fecha de ejecución" value={formatDate(remittance.executionDate)} helper={`Generada el ${formatDateTime(remittance.createdAt)}`} />
        <MetricCard label="Confirmada" value={remittance.confirmedAt ? formatDate(remittance.confirmedAt) : "No"} helper={remittance.confirmedAt ? "Pagos registrados" : "Sin pagos registrados todavía"} tone={remittance.confirmedAt ? "success" : "warning"} />
      </section>
      <PageSection title="Pagos incluidos" description="Una transferencia por factura.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proveedor</TableHead>
                <TableHead>Factura</TableHead>
                <TableHead>IBAN</TableHead>
                <TableHead>Referencia</TableHead>
                <TableHead className="text-right">Importe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {remittance.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.creditorName}</TableCell>
                  <TableCell>
                    <Link className="text-primary hover:underline" href={item.invoiceOrigin === "EXPENSE" ? `/expenses/${item.supplierInvoiceId}` : `/purchases/supplier-invoices?q=${encodeURIComponent(item.invoiceNumber)}`}>{item.invoiceNumber}</Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{formatIban(item.creditorIban)}</TableCell>
                  <TableCell className="font-mono text-xs">{item.endToEndId}</TableCell>
                  <TableCell className="text-right font-mono">{formatMoney(item.amount, currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PageSection>
    </PageShell>
  );
}
