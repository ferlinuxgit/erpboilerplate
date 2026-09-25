import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CreateSalesOrderForm } from "@/components/sales/create-sales-order-form";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { salesOrder, salesOrderLine } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { dateInputValue } from "@/lib/date-input";
import { loadSalesFormData } from "@/server/sales/form-data";
import { orderChangeBlocker } from "@/server/sales/service";

export const metadata: Metadata = { title: "Editar pedido" };

export default async function EditSalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("invoice.create");
  const { id } = await params;
  const [record] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, id), eq(salesOrder.companyId, ctx.company.id)))
    .limit(1);
  if (!record) notFound();
  const [blocker, lines, formData] = await Promise.all([
    orderChangeBlocker(db, ctx.company.id, record, "edit"),
    db.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, id)),
    loadSalesFormData(ctx.company.id, { includeCustomerId: record.customerId }),
  ]);

  return (
    <PageShell>
      <PageHeader
        title={`Editar pedido ${record.number}`}
        description="Cambia cliente, fecha o líneas mientras el pedido no tenga albaranes ni factura."
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Pedidos", href: "/sales/orders" },
          { label: record.number, href: `/sales/orders/${id}` },
          { label: "Editar" },
        ]}
      />
      <PageSection title="Datos del pedido" description="Los importes se recalculan al guardar.">
        {blocker ? (
          <InlineAlert title="Este pedido ya no se puede editar" tone="info">
            {blocker}
            <p className="mt-2">
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/sales/orders/${id}`}>Volver al pedido</Link>
            </p>
          </InlineAlert>
        ) : (
          <CreateSalesOrderForm
            currencyCode={ctx.company.baseCurrencyCode}
            customers={formData.customers}
            defaultTaxRate={formData.defaultTaxRate}
            initialValues={{
              customerId: record.customerId,
              number: record.number,
              issueDate: dateInputValue(record.issueDate, ctx.company.timezone),
              lines: lines.map((line) => ({
                description: line.description,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                taxRate: line.taxRate,
                discountPct: line.discountPct,
                retentionRate: line.retentionRate,
              })),
            }}
            orderId={id}
          />
        )}
      </PageSection>
    </PageShell>
  );
}
