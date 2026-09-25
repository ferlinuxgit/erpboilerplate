import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CreateSupplierInvoiceFromReceiptButton } from "@/components/purchases/create-supplier-invoice-from-receipt-button";
import { buttonVariants } from "@/components/ui/button";
import {
  MetricCard,
  PageHeader,
  PageSection,
  PageShell,
} from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  goodsReceipt,
  goodsReceiptLine,
  item,
  partner,
  purchaseOrder,
  warehouse,
} from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/rbac";
import { getPurchaseInvoiceContext } from "@/server/purchases/invoice-context";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  try {
    const ctx = await requireContext("purchase.read");
    const { id } = await params;
    const [row] = await db
      .select({ number: goodsReceipt.number })
      .from(goodsReceipt)
      .innerJoin(purchaseOrder, eq(purchaseOrder.id, goodsReceipt.purchaseOrderId))
      .where(and(eq(goodsReceipt.id, id), eq(purchaseOrder.companyId, ctx.company.id)))
      .limit(1);
    return { title: row ? `Recepción ${row.number}` : "Recepción" };
  } catch {
    return { title: "Recepción" };
  }
}

export default async function PurchaseReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireContext("purchase.read");
  const { id } = await params;
  const [record] = await db
    .select({
      id: goodsReceipt.id,
      number: goodsReceipt.number,
      receivedAt: goodsReceipt.receivedAt,
      orderId: purchaseOrder.id,
      orderNumber: purchaseOrder.number,
      supplierPartnerId: partner.id,
      supplierName: partner.name,
      warehouseName: warehouse.name,
      supplierDocumentNumber: goodsReceipt.supplierDocumentNumber,
      notes: goodsReceipt.notes,
    })
    .from(goodsReceipt)
    .innerJoin(
      purchaseOrder,
      eq(purchaseOrder.id, goodsReceipt.purchaseOrderId),
    )
    .innerJoin(partner, eq(partner.id, purchaseOrder.supplierPartnerId))
    .leftJoin(warehouse, eq(warehouse.id, goodsReceipt.warehouseId))
    .where(
      and(eq(goodsReceipt.id, id), eq(purchaseOrder.companyId, ctx.company.id)),
    )
    .limit(1);
  if (!record) notFound();
  const [receiptLines, invoiceContext] = await Promise.all([
    db
      .select({
        id: goodsReceiptLine.id,
        itemName: item.name,
        quantity: goodsReceiptLine.quantity,
      })
      .from(goodsReceiptLine)
      .leftJoin(item, eq(item.id, goodsReceiptLine.itemId))
      .where(eq(goodsReceiptLine.goodsReceiptId, id)),
    getPurchaseInvoiceContext(ctx.company.id, record.orderId),
  ]);
  const totalQuantity = receiptLines.reduce(
    (total, line) => total + Number(line.quantity),
    0,
  );
  const thisReceipt = invoiceContext?.receipts.find((receipt) => receipt.id === id);
  const linkedInvoice = thisReceipt?.invoiceId ? { id: thisReceipt.invoiceId, number: thisReceipt.invoiceNumber } : null;
  const canWrite = can(ctx.membership.role, "purchase.write");
  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Aprovisionamiento" },
          { label: "Recepciones", href: "/purchases/receipts" },
          { label: record.number },
        ]}
        title={record.number}
        description={`${record.supplierName} · ${formatDate(record.receivedAt)}`}
        meta={
          <StatusBadge tone={linkedInvoice ? "success" : "warning"}>
            {linkedInvoice ? `Facturada (${linkedInvoice.number})` : "Pendiente de factura"}
          </StatusBadge>
        }
        actions={
          <>
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/purchases/orders/${record.orderId}`}
            >
              Ver pedido
            </Link>
            {linkedInvoice ? (
              <Link
                className={buttonVariants()}
                href={`/expenses/${linkedInvoice.id}`}
              >
                Ver factura
              </Link>
            ) : canWrite && invoiceContext ? (
              <CreateSupplierInvoiceFromReceiptButton
                context={invoiceContext}
                currencyCode={ctx.company.baseCurrencyCode}
                initialReceiptIds={[record.id]}
              />
            ) : null}
          </>
        }
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Pedido"
          value={record.orderNumber}
          helper={record.supplierName}
        />
        <MetricCard
          label="Almacén"
          value={record.warehouseName ?? "No informado"}
          helper={record.supplierDocumentNumber ? `Albarán ${record.supplierDocumentNumber}` : "Sin referencia externa"}
        />
        <MetricCard
          label="Unidades"
          value={totalQuantity.toLocaleString("es-ES", {
            maximumFractionDigits: 3,
          })}
          helper="Cantidad total recibida"
        />
      </section>
      {record.notes ? <PageSection title="Observaciones" description="Información registrada durante la recepción."><p className="text-sm leading-6">{record.notes}</p></PageSection> : null}
      <PageSection
        title="Detalle recibido"
        description="Cantidades incorporadas al stock con esta recepción."
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artículo</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receiptLines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.itemName ?? "Artículo sin ficha"}</TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(line.quantity).toLocaleString("es-ES", {
                      maximumFractionDigits: 3,
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PageSection>
    </PageShell>
  );
}
