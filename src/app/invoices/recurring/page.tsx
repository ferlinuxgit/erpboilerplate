import type { Metadata } from "next";
import Link from "next/link";

import { RecurringTemplatesList } from "@/components/recurring/recurring-templates-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { listRecurringTemplates } from "@/server/recurring/service";

export const metadata: Metadata = { title: "Facturas recurrentes" };

export default async function RecurringInvoicesPage() {
  await requireUserSession();
  const ctx = await requireContext("invoice.read");
  const rows = await listRecurringTemplates(ctx.company.id, "SALES_INVOICE");
  const canEdit = can(ctx.membership.role, "invoice.create");

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Comercial" }, { label: "Facturas", href: "/invoices" }, { label: "Recurrentes" }]}
        title="Facturas recurrentes"
        description="Cuotas, mantenimientos o alquileres que facturas cada periodo. Se preparan solas en su fecha: como borrador para revisar o emitidas y enviadas."
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href="/invoices/collections/settings">Plantillas de email</Link>
            {canEdit ? <Link className={buttonVariants()} href="/invoices/recurring/new">Nueva factura recurrente</Link> : null}
          </>
        }
      />
      <PageSection title="Recurrencias" description="Pausa una recurrencia para dejar de generarla temporalmente; al reanudarla no se crean los periodos que pasaron en pausa.">
        <RecurringTemplatesList basePath="/invoices/recurring" canEdit={canEdit} currencyCode={ctx.company.baseCurrencyCode} kind="SALES_INVOICE" rows={rows} />
      </PageSection>
    </PageShell>
  );
}
