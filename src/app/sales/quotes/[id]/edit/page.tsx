import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CreateSalesQuoteForm } from "@/components/sales/create-sales-quote-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, partner, salesQuote, salesQuoteLine } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { dateInputValue } from "@/lib/date-input";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("invoice.create");
    const { id } = await params;
    const [row] = await db
      .select({ number: salesQuote.number })
      .from(salesQuote)
      .where(and(eq(salesQuote.id, id), eq(salesQuote.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Editar presupuesto ${row.number}` : "Editar presupuesto" };
  } catch {
    return { title: "Editar presupuesto" };
  }
}

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
      .select({ id: customer.id, number: partner.number, name: customer.name })
      .from(customer)
      .leftJoin(partner, eq(partner.id, customer.partnerId))
      .where(eq(customer.companyId, ctx.company.id))
      .orderBy(asc(customer.name)),
    db.select().from(salesQuoteLine).where(eq(salesQuoteLine.salesQuoteId, id)),
  ]);
  return (
    <PageShell>
      <PageHeader
        title={`Editar ${record.number}`}
        description="Modifica la cabecera y las líneas mientras el presupuesto siga en borrador."
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Presupuestos", href: "/sales/quotes" },
          { label: record.number, href: `/sales/quotes/${id}` },
          { label: "Editar" },
        ]}
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
            issueDate: dateInputValue(record.issueDate, ctx.company.timezone),
            validUntil: record.validUntil ? dateInputValue(record.validUntil, ctx.company.timezone) : "",
            lines: lines.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxRate: line.taxRate,
              discountPct: line.discountPct,
              retentionRate: line.retentionRate,
            })),
          }}
        />
      </PageSection>
    </PageShell>
  );
}
