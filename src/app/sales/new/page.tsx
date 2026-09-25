import type { Metadata } from "next";
import Link from "next/link";

import { CreateSalesQuoteForm } from "@/components/sales/create-sales-quote-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { loadSalesFormData } from "@/server/sales/form-data";

export const metadata: Metadata = { title: "Nuevo presupuesto" };

export default async function NewSalesQuotePage({ searchParams }: { searchParams: Promise<{ customerId?: string | string[] }> }) {
  const ctx = await requireContext("invoice.create");
  const params = await searchParams;
  const initialCustomerId = Array.isArray(params.customerId) ? params.customerId[0] : params.customerId;
  const { customers, defaultTaxRate } = await loadSalesFormData(ctx.company.id);

  return (
    <PageShell>
      <PageHeader
        title="Nuevo presupuesto"
        description={`Prepara una propuesta comercial para ${ctx.company.name}.`}
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Presupuestos", href: "/sales/quotes" },
          { label: "Nuevo presupuesto" },
        ]}
      />
      <PageSection title="Datos del presupuesto" description="Selecciona el cliente, define la vigencia y añade los conceptos de la propuesta.">
        {customers.length === 0 ? (
          <EmptyState title="Falta un cliente" description="Crea al menos un cliente antes de preparar un presupuesto." action={<Link className={buttonVariants()} href="/customers/new">Crear cliente</Link>} />
        ) : <CreateSalesQuoteForm customers={customers} defaultTaxRate={defaultTaxRate} initialCustomerId={initialCustomerId} />}
      </PageSection>
    </PageShell>
  );
}
