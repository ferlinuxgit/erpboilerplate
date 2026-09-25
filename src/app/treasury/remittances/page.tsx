import Link from "next/link";

import { remittanceStatusLabels, remittanceStatusTone } from "@/components/treasury/remittance-status";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { listRemittances } from "@/server/sepa/service";

export default async function RemittancesPage() {
  const ctx = await requireContext("treasury.read");
  const remittances = await listRemittances(ctx.company.id);
  const canWrite = can(ctx.membership.role, "treasury.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Remesas de pagos (SEPA)"
        description="Paga varias facturas de proveedores de una vez: genera el fichero, súbelo a tu banca online y confirma cuando el banco lo cargue."
        backHref="/treasury"
        backLabel="Volver al resumen"
        actions={canWrite ? <Link className={buttonVariants()} href="/treasury/remittances/new">Nueva remesa</Link> : null}
      />
      <PageSection title="Remesas" description="Las más recientes primero.">
        {remittances.length === 0 ? (
          <EmptyState title="Todavía no hay remesas" description="Crea una remesa con las facturas de proveedores que quieras pagar." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Remesa</TableHead>
                  <TableHead>Cuenta de cargo</TableHead>
                  <TableHead>Ejecución</TableHead>
                  <TableHead className="text-right">Pagos</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remittances.map((remittance) => (
                  <TableRow key={remittance.id}>
                    <TableCell><Link className="font-mono text-primary hover:underline" href={`/treasury/remittances/${remittance.id}`}>{remittance.number}</Link></TableCell>
                    <TableCell className="text-sm">{remittance.bankName}</TableCell>
                    <TableCell>{formatDate(remittance.executionDate)}</TableCell>
                    <TableCell className="text-right">{remittance.itemCount}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(remittance.totalAmount, ctx.company.baseCurrencyCode)}</TableCell>
                    <TableCell><StatusBadge tone={remittanceStatusTone(remittance.status)}>{remittanceStatusLabels[remittance.status] ?? remittance.status}</StatusBadge></TableCell>
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
