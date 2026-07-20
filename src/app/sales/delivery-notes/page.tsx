import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { SalesDocumentsList } from "@/components/sales/sales-documents-list";
import { buttonVariants } from "@/components/ui/button";
import { MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { customer, deliveryNote, salesOrder } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";

export default async function DeliveryNotesPage() {
  const ctx = await requireContext("invoice.read");
  const rows = await db
    .select({
      id: deliveryNote.id,
      number: deliveryNote.number,
      customerName: customer.name,
      date: deliveryNote.issuedAt,
      status: deliveryNote.status,
      orderNumber: salesOrder.number,
    })
    .from(deliveryNote)
    .innerJoin(customer, eq(customer.id, deliveryNote.customerId))
    .leftJoin(salesOrder, eq(salesOrder.id, deliveryNote.salesOrderId))
    .where(eq(deliveryNote.companyId, ctx.company.id))
    .orderBy(desc(deliveryNote.issuedAt));

  const delivered = rows.filter((row) => row.status === "DELIVERED").length;
  const invoiced = rows.filter((row) => row.status === "INVOICED").length;
  const voided = rows.filter((row) => row.status === "VOID").length;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Ventas"
        title="Albaranes"
        description="Entregas realizadas al cliente y pendientes de convertir en factura."
        backHref="/sales"
        backLabel="Volver a ventas"
        actions={<Link className={buttonVariants({ variant: "outline" })} href="/sales/orders">Ver pedidos</Link>}
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Albaranes" value={rows.length} helper="Entregas registradas" />
        <MetricCard label="Por facturar" value={delivered} helper="Entregados sin factura" tone={delivered > 0 ? "warning" : "neutral"} />
        <MetricCard label="Facturados" value={invoiced} helper="Convertidos en factura" tone={invoiced > 0 ? "success" : "neutral"} />
        <MetricCard label="Anulados" value={voided} helper="Entregas canceladas" tone={voided > 0 ? "danger" : "neutral"} />
      </section>
      <PageSection title="Listado de albaranes" description="Consulta las entregas y abre su ficha para revisar líneas o generar la factura.">
        <SalesDocumentsList
          basePath="/sales/delivery-notes"
          currencyCode={ctx.company.baseCurrencyCode}
          dateLabel="Entrega"
          emptyDescription="Los albaranes aparecerán al preparar una entrega desde un pedido confirmado."
          emptyTitle="Sin albaranes"
          rows={rows.map((row) => ({ ...row, originLabel: row.orderNumber ? `Pedido ${row.orderNumber}` : null }))}
          testId="sales-delivery-notes-list"
          title="Albaranes"
        />
      </PageSection>
    </PageShell>
  );
}
