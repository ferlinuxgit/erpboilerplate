import { and, eq } from "drizzle-orm";
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
  purchaseOrderLine,
  supplierInvoice,
  tax,
  warehouse,
} from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { can } from "@/lib/rbac";

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
  const [receiptLines, orderLines, linkedInvoices] = await Promise.all([
    db
      .select({
        id: goodsReceiptLine.id,
        itemId: goodsReceiptLine.itemId,
        itemName: item.name,
        taxRate: tax.rate,
        quantity: goodsReceiptLine.quantity,
      })
      .from(goodsReceiptLine)
      .leftJoin(item, eq(item.id, goodsReceiptLine.itemId))
      .leftJoin(tax, eq(tax.id, item.defaultTaxId))
      .where(eq(goodsReceiptLine.goodsReceiptId, id)),
    db
      .select()
      .from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.purchaseOrderId, record.orderId)),
    db
      .select({ id: supplierInvoice.id, number: supplierInvoice.number })
      .from(supplierInvoice)
      .where(
        and(
          eq(supplierInvoice.companyId, ctx.company.id),
          eq(supplierInvoice.goodsReceiptId, id),
        ),
      ),
  ]);
  const totalQuantity = receiptLines.reduce(
    (total, line) => total + Number(line.quantity),
    0,
  );
  const orderLineByItem = new Map(
    orderLines
      .filter((line) => line.itemId)
      .map((line) => [line.itemId as string, line]),
  );
  const invoicePayloadLines = receiptLines.map((line) => {
    const source = line.itemId ? orderLineByItem.get(line.itemId) : undefined;
    return {
      itemId: line.itemId ?? undefined,
      description: source?.description ?? line.itemName ?? "Mercancía recibida",
      quantity: Number(line.quantity),
      unitPrice: Number(source?.unitPrice ?? 0),
      taxRate: Number(line.taxRate ?? 0),
    };
  });
  const canWrite = can(ctx.membership.role, "purchase.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Recepción"
        title={record.number}
        description={`${record.supplierName} · ${formatDate(record.receivedAt)}`}
        backHref="/purchases/receipts"
        backLabel="Volver a recepciones"
        meta={
          <StatusBadge tone={linkedInvoices.length > 0 ? "success" : "warning"}>
            {linkedInvoices.length > 0 ? "Facturada" : "Pendiente de factura"}
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
            {linkedInvoices[0] ? (
              <Link
                className={buttonVariants()}
                href={`/expenses/${linkedInvoices[0].id}`}
              >
                Ver factura
              </Link>
            ) : canWrite ? (
              <CreateSupplierInvoiceFromReceiptButton
                payload={{
                  supplierPartnerId: record.supplierPartnerId,
                  purchaseOrderId: record.orderId,
                  goodsReceiptId: record.id,
                  lines: invoicePayloadLines,
                }}
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
