import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SalesDocumentLines } from "@/components/sales/sales-document-lines";
import { SalesTransitionButton } from "@/components/sales/sales-transition-button";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { customer, deliveryNote, deliveryNoteLine } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { getDeliveryNoteTransition } from "@/lib/document-pipelines";
import { formatDate } from "@/lib/format";
import { salesDocumentStatusLabels, salesDocumentStatusTone, statusLabel } from "@/lib/status-labels";

export default async function DeliveryNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("invoice.read");
  const { id } = await params;
  const [record] = await db
    .select({
      id: deliveryNote.id,
      number: deliveryNote.number,
      customerId: deliveryNote.customerId,
      customerName: customer.name,
      salesOrderId: deliveryNote.salesOrderId,
      issuedAt: deliveryNote.issuedAt,
      status: deliveryNote.status,
    })
    .from(deliveryNote)
    .innerJoin(customer, eq(customer.id, deliveryNote.customerId))
    .where(and(eq(deliveryNote.id, id), eq(deliveryNote.companyId, ctx.company.id)))
    .limit(1);
  if (!record) notFound();

  const lines = await db.select().from(deliveryNoteLine).where(eq(deliveryNoteLine.deliveryNoteId, id));
  const transition = getDeliveryNoteTransition(record.status);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Ventas · Albarán"
        title={record.number}
        description={`${record.customerName} · Entregado el ${formatDate(record.issuedAt)}`}
        backHref="/sales/delivery-notes"
        backLabel="Volver a albaranes"
        meta={<StatusBadge tone={salesDocumentStatusTone(record.status)}>{statusLabel(salesDocumentStatusLabels, record.status)}</StatusBadge>}
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline" })} href={`/customers/${record.customerId}`}>Ver cliente</Link>
            {record.salesOrderId ? <Link className={buttonVariants({ variant: "outline" })} href={`/sales/orders/${record.salesOrderId}`}>Ver pedido</Link> : null}
            {transition.allowed ? <SalesTransitionButton label={transition.actionLabel ?? "Generar factura"} targetBasePath="/invoices" url={`/api/delivery-notes/${record.id}/to-invoice`} /> : null}
          </>
        }
      />
      <PageSection title="Productos entregados" description="Cantidades descontadas del almacén al confirmar la entrega.">
        <SalesDocumentLines currencyCode={ctx.company.baseCurrencyCode} lines={lines} />
      </PageSection>
      <PageSection title="Datos del albarán" description="Origen y situación del documento." contentClassName="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-muted/35 p-3"><p className="text-muted-foreground">Fecha</p><p className="mt-1 font-medium">{formatDate(record.issuedAt)}</p></div>
        <div className="rounded-lg bg-muted/35 p-3"><p className="text-muted-foreground">Líneas</p><p className="mt-1 font-medium">{lines.length}</p></div>
        <div className="rounded-lg bg-muted/35 p-3"><p className="text-muted-foreground">Estado</p><p className="mt-1 font-medium">{statusLabel(salesDocumentStatusLabels, record.status)}</p></div>
      </PageSection>
    </PageShell>
  );
}
