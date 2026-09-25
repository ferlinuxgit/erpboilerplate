import Link from "next/link";

import { directDebitStatusLabels, directDebitStatusTone } from "@/components/treasury/direct-debit-status";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { listDirectDebitRemittances } from "@/server/sepa/direct-debits";

export default async function DirectDebitRemittancesPage() {
  const ctx = await requireContext("treasury.read");
  const remittances = await listDirectDebitRemittances(ctx.company.id);
  const canWrite = can(ctx.membership.role, "treasury.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Remesas de cobros (recibos SEPA)"
        description="Cobra las facturas de tus clientes domiciliados de una vez: genera el fichero de recibos, súbelo a tu banca online y márcalo como cobrado cuando el banco lo abone."
        backHref="/treasury"
        backLabel="Volver al resumen"
        actions={canWrite ? <Link className={buttonVariants()} href="/treasury/direct-debits/new">Nueva remesa de cobros</Link> : null}
      />
      <PageSection title="Remesas" description="Las más recientes primero.">
        {remittances.length === 0 ? (
          <EmptyState title="Todavía no hay remesas de cobros" description="Necesitas tu identificador de acreedor SEPA (Ajustes › Empresa) y un mandato firmado en la ficha de cada cliente." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Remesa</TableHead>
                  <TableHead>Cuenta de abono</TableHead>
                  <TableHead>Cobro</TableHead>
                  <TableHead className="text-right">Recibos</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remittances.map((remittance) => (
                  <TableRow key={remittance.id}>
                    <TableCell><Link className="font-mono text-primary hover:underline" href={`/treasury/direct-debits/${remittance.id}`}>{remittance.number}</Link></TableCell>
                    <TableCell className="text-sm">{remittance.bankName}</TableCell>
                    <TableCell>{formatDate(remittance.collectionDate)}</TableCell>
                    <TableCell className="text-right">{remittance.itemCount}{remittance.returned > 0 ? <span className="block text-xs text-destructive">{remittance.returned} {remittance.returned === 1 ? "devuelto" : "devueltos"}</span> : null}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(remittance.totalAmount, ctx.company.baseCurrencyCode)}</TableCell>
                    <TableCell><StatusBadge tone={directDebitStatusTone(remittance.status)}>{directDebitStatusLabels[remittance.status] ?? remittance.status}</StatusBadge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}
