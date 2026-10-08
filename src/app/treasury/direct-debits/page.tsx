import Link from "next/link";

import { DirectDebitRemittancesList } from "@/components/treasury/direct-debit-remittances-list";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
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
          <EmptyState title="Todavía no hay remesas de cobros" description="Necesitas tu identificador de acreedor SEPA (Configuración › Cobros y pagos) y un mandato firmado en la ficha de cada cliente." />
        ) : (
          <DirectDebitRemittancesList currency={ctx.company.baseCurrencyCode} rows={remittances} />
        )}
      </PageSection>
    </PageShell>
  );
}
