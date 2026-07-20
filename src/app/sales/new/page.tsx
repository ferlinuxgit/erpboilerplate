import { asc, eq } from "drizzle-orm";
import Link from "next/link";

import { CreateSalesQuoteForm } from "@/components/sales/create-sales-quote-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export default async function NewSalesQuotePage({ searchParams }: { searchParams: Promise<{ customerId?: string | string[] }> }) {
  const ctx = await requireContext("invoice.create");
  const params = await searchParams;
  const initialCustomerId = Array.isArray(params.customerId) ? params.customerId[0] : params.customerId;
  const customers = await db.select({ id: customer.id, name: customer.name }).from(customer).where(eq(customer.companyId, ctx.company.id)).orderBy(asc(customer.name));

  return (
    <PageShell>
      <PageHeader eyebrow="Ventas · Presupuestos" title="Nuevo presupuesto" description={`Prepara una propuesta comercial para ${ctx.company.name}.`} backHref="/sales/quotes" backLabel="Volver a presupuestos" />
      <PageSection title="Datos del presupuesto" description="Selecciona el cliente, define la vigencia y añade los conceptos de la propuesta.">
        {customers.length === 0 ? (
          <EmptyState title="Falta un cliente" description="Crea al menos un cliente antes de preparar un presupuesto." action={<Link className={buttonVariants()} href="/customers/new">Crear cliente</Link>} />
        ) : <CreateSalesQuoteForm customers={customers} initialCustomerId={initialCustomerId} />}
      </PageSection>
    </PageShell>
  );
}
