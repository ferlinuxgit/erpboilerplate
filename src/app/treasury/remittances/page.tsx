import Link from "next/link";

import { RemittancesList } from "@/components/treasury/remittances-list";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
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
          <RemittancesList currency={ctx.company.baseCurrencyCode} rows={remittances} />
        )}
      </PageSection>
    </PageShell>
  );
}
