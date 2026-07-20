import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { SalesDocumentsList } from "@/components/sales/sales-documents-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, salesQuote } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";

export default async function SalesQuotesPage() {
  const ctx = await requireContext("invoice.read");
  const rows = await db
    .select({
      id: salesQuote.id,
      number: salesQuote.number,
      customerName: customer.name,
      date: salesQuote.issueDate,
      validUntil: salesQuote.validUntil,
      totalAmount: salesQuote.totalAmount,
      status: salesQuote.status,
    })
    .from(salesQuote)
    .innerJoin(customer, eq(customer.id, salesQuote.customerId))
    .where(eq(salesQuote.companyId, ctx.company.id))
    .orderBy(desc(salesQuote.issueDate));

  const drafts = rows.filter((row) => row.status === "DRAFT").length;
  const confirmed = rows.filter((row) => row.status === "CONFIRMED").length;
  const amount = rows.filter((row) => row.status !== "VOID").reduce((sum, row) => sum + Number(row.totalAmount), 0);
  const canCreate = can(ctx.membership.role, "invoice.create");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Presupuestos"
        title="Presupuestos"
        description="Propuestas comerciales enviadas a clientes, con vigencia, importe y estado de aceptación."
        actions={canCreate ? <Link className={buttonVariants()} href="/sales/new">Nuevo presupuesto</Link> : null}
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Presupuestos" value={rows.length} helper="Documentos registrados" />
        <MetricCard label="Borradores" value={drafts} helper="Pendientes de completar" tone={drafts > 0 ? "warning" : "neutral"} />
        <MetricCard label="Confirmados" value={confirmed} helper="Aceptados o convertidos" tone={confirmed > 0 ? "success" : "neutral"} />
        <MetricCard label="Importe propuesto" value={formatMoney(amount, ctx.company.baseCurrencyCode)} helper="Excluye anulados" />
      </section>
      <PageSection title="Listado de presupuestos" description="Busca, ordena, configura columnas, guarda vistas y exporta el resultado.">
        <SalesDocumentsList
          basePath="/sales/quotes"
          currencyCode={ctx.company.baseCurrencyCode}
          dateLabel="Emisión"
          emptyDescription="Crea el primer presupuesto para preparar una propuesta comercial."
          emptyTitle="Sin presupuestos"
          rows={rows}
          testId="sales-quotes-list"
          title="Presupuestos"
        />
      </PageSection>
    </PageShell>
  );
}
