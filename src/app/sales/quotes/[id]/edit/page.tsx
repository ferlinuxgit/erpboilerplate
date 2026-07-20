import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { CreateSalesQuoteForm } from "@/components/sales/create-sales-quote-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, salesQuote, salesQuoteLine } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export default async function EditSalesQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireContext("invoice.create");
  const { id } = await params;
  const [record] = await db
    .select()
    .from(salesQuote)
    .where(and(eq(salesQuote.id, id), eq(salesQuote.companyId, ctx.company.id)))
    .limit(1);
  if (!record || record.status !== "DRAFT") notFound();
  const [customers, lines] = await Promise.all([
    db
      .select({ id: customer.id, name: customer.name })
      .from(customer)
      .where(eq(customer.companyId, ctx.company.id))
      .orderBy(asc(customer.name)),
    db.select().from(salesQuoteLine).where(eq(salesQuoteLine.salesQuoteId, id)),
  ]);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Presupuestos"
        title={`Editar ${record.number}`}
        description="Modifica la cabecera y las líneas mientras el presupuesto siga en borrador."
        backHref={`/sales/quotes/${id}`}
        backLabel="Volver al presupuesto"
      />
      <PageSection
        title="Datos del presupuesto"
        description="Los importes e impuestos se recalculan al guardar."
      >
        <CreateSalesQuoteForm
          customers={customers}
          quoteId={id}
          initialValues={{
            customerId: record.customerId,
            number: record.number,
            issueDate: record.issueDate.toISOString().slice(0, 10),
            validUntil: record.validUntil?.toISOString().slice(0, 10) ?? "",
            lines: lines.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxRate: line.taxRate,
            })),
          }}
        />
      </PageSection>
    </PageShell>
  );
}
