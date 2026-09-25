import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
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
import { getDeliveryNoteTransition, type SalesDocumentStatus } from "@/lib/document-pipelines";
import { formatDate } from "@/lib/format";
import { salesStatusLabel, salesStatusTone } from "@/components/sales/sales-status";
import { can } from "@/lib/rbac";
import { paymentTermsLabel } from "@/server/invoices/due-dates";
import { resolveCustomerBillingDefaults } from "@/server/invoices/service";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("invoice.read");
    const { id } = await params;
    const [row] = await db
      .select({ number: deliveryNote.number })
      .from(deliveryNote)
      .where(and(eq(deliveryNote.id, id), eq(deliveryNote.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Albarán ${row.number}` : "Albarán" };
  } catch {
    return { title: "Albarán" };
  }
}

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
  const transition = getDeliveryNoteTransition(record.status as SalesDocumentStatus);
  const canInvoice = transition.allowed && can(ctx.membership.role, "invoice.create");
  const billing = canInvoice ? await resolveCustomerBillingDefaults(db, ctx.company.id, record.customerId) : null;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Comercial" },
          { label: "Albaranes", href: "/sales/delivery-notes" },
          { label: record.number },
        ]}
        title={record.number}
        description={`${record.customerName} · Entregado el ${formatDate(record.issuedAt)}`}
        meta={<StatusBadge tone={salesStatusTone(record.status)}>{salesStatusLabel(record.status, "delivery")}</StatusBadge>}
        actions={
          <>
            <a className={buttonVariants({ variant: "outline" })} href={`/api/delivery-notes/${record.id}/pdf`} rel="noreferrer" target="_blank">PDF</a>
            <Link className={buttonVariants({ variant: "outline" })} href={`/customers/${record.customerId}`}>Ver cliente</Link>
            {record.salesOrderId ? <Link className={buttonVariants({ variant: "outline" })} href={`/sales/orders/${record.salesOrderId}`}>Ver pedido</Link> : null}
            {canInvoice && billing ? (
              <SalesTransitionButton
                confirmDescription={`Se emitirá ya la factura definitiva a ${record.customerName} con los productos de este albarán y los precios del pedido: tendrá el siguiente número de la serie, se contabilizará y quedará registrada en VERI*FACTU. Vencimiento: ${paymentTermsLabel(billing.termsDays)}. Después no se podrá modificar; para corregirla habrá que hacer una rectificativa.`}
                confirmLabel="Emitir la factura"
                confirmTitle="¿Emitir la factura de este albarán?"
                label={transition.allowed ? transition.actionLabel : "Generar factura"}
                successMessage="Factura {number} emitida correctamente."
                targetBasePath="/invoices"
                testId="delivery-to-invoice"
                url={`/api/delivery-notes/${record.id}/to-invoice`}
              />
            ) : null}
          </>
        }
      />
      <PageSection title="Productos entregados" description="Cantidades descontadas del almacén al confirmar la entrega.">
        <SalesDocumentLines currencyCode={ctx.company.baseCurrencyCode} lines={lines} />
      </PageSection>
      <PageSection title="Datos del albarán" description="Origen y situación del documento." contentClassName="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-[2px] bg-muted/35 p-3"><p className="text-muted-foreground">Fecha</p><p className="mt-1 font-medium">{formatDate(record.issuedAt)}</p></div>
        <div className="rounded-[2px] bg-muted/35 p-3"><p className="text-muted-foreground">Líneas</p><p className="mt-1 font-medium">{lines.length}</p></div>
        <div className="rounded-[2px] bg-muted/35 p-3"><p className="text-muted-foreground">Estado</p><p className="mt-1 font-medium">{salesStatusLabel(record.status, "delivery")}</p></div>
      </PageSection>
    </PageShell>
  );
}
