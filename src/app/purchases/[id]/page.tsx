import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DownloadSimple as Download } from "@phosphor-icons/react/dist/ssr";
import { ReceivePurchaseButton } from "@/components/purchases/receive-purchase-button";
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
  partner,
  purchaseOrder,
  purchaseOrderLine,
  supplierInvoice,
  supplierPayment,
  warehouse,
} from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { getPurchaseOrderReceiptTransition } from "@/lib/document-pipelines";
import { can } from "@/lib/rbac";
import {
  invoicePaymentStatusLabels,
  purchaseOrderStatusLabels,
  purchaseOrderStatusTone,
  statusLabel,
} from "@/lib/status-labels";
export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireContext("purchase.read");
  const { id } = await params;
  const [record] = await db
    .select({
      id: purchaseOrder.id,
      number: purchaseOrder.number,
      status: purchaseOrder.status,
      supplierPartnerId: partner.id,
      supplierName: partner.name,
      createdAt: purchaseOrder.createdAt,
    })
    .from(purchaseOrder)
    .innerJoin(partner, eq(partner.id, purchaseOrder.supplierPartnerId))
    .where(
      and(
        eq(purchaseOrder.id, id),
        eq(purchaseOrder.companyId, ctx.company.id),
      ),
    )
    .limit(1);
  if (!record) notFound();
  const [lines, receipts, receiptLines, invoices, warehouses] = await Promise.all([
    db
      .select()
      .from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.purchaseOrderId, id)),
    db.select().from(goodsReceipt).where(eq(goodsReceipt.purchaseOrderId, id)),
    db
      .select({
        purchaseOrderLineId: goodsReceiptLine.purchaseOrderLineId,
        itemId: goodsReceiptLine.itemId,
        quantity: goodsReceiptLine.quantity,
      })
      .from(goodsReceiptLine)
      .innerJoin(goodsReceipt, eq(goodsReceipt.id, goodsReceiptLine.goodsReceiptId))
      .where(eq(goodsReceipt.purchaseOrderId, id)),
    db
      .select()
      .from(supplierInvoice)
      .where(
        and(
          eq(supplierInvoice.companyId, ctx.company.id),
          eq(supplierInvoice.purchaseOrderId, id),
        ),
      ),
    db
      .select({ id: warehouse.id, name: warehouse.name })
      .from(warehouse)
      .where(and(eq(warehouse.companyId, ctx.company.id), eq(warehouse.isActive, true))),
  ]);
  const invoiceIds = invoices.map((row) => row.id);
  const payments =
    invoiceIds.length === 0
      ? []
      : (
          await Promise.all(
            invoiceIds.map((invoiceId) =>
              db
                .select()
                .from(supplierPayment)
                .where(
                  and(
                    eq(supplierPayment.companyId, ctx.company.id),
                    eq(supplierPayment.supplierInvoiceId, invoiceId),
                  ),
                ),
            ),
          )
        ).flat();
  const total = lines.reduce((sum, line) => sum + Number(line.lineTotal), 0);
  const paid = payments.reduce(
    (sum, payment) => sum + Number(payment.amount),
    0,
  );
  const receivedByLine = new Map<string, number>();
  const legacyReceivedByItem = new Map<string, number>();
  for (const line of receiptLines) {
    if (!line.itemId) continue;
    if (line.purchaseOrderLineId) {
      receivedByLine.set(line.purchaseOrderLineId, (receivedByLine.get(line.purchaseOrderLineId) ?? 0) + Number(line.quantity));
    } else {
      legacyReceivedByItem.set(line.itemId, (legacyReceivedByItem.get(line.itemId) ?? 0) + Number(line.quantity));
    }
  }
  for (const line of lines) {
    if (!line.itemId) continue;
    const legacyQuantity = legacyReceivedByItem.get(line.itemId) ?? 0;
    if (legacyQuantity <= 0) continue;
    const allocated = Math.min(legacyQuantity, Math.max(Number(line.quantity) - (receivedByLine.get(line.id) ?? 0), 0));
    receivedByLine.set(line.id, (receivedByLine.get(line.id) ?? 0) + allocated);
    legacyReceivedByItem.set(line.itemId, legacyQuantity - allocated);
  }
  const pendingReceiptLines = lines.flatMap((line) => {
      if (!line.itemId) return [];
      const receivedQuantity = receivedByLine.get(line.id) ?? 0;
      const orderedQuantity = Number(line.quantity);
      const pendingQuantity = Math.max(orderedQuantity - receivedQuantity, 0);
      return pendingQuantity > 0.0005
        ? [
            {
              purchaseOrderLineId: line.id,
              itemId: line.itemId,
              description: line.description,
              orderedQuantity,
              receivedQuantity,
              pendingQuantity,
            },
          ]
        : [];
    });
  const transition = getPurchaseOrderReceiptTransition({
    status: record.status,
    hasReceipt: pendingReceiptLines.length === 0 && receipts.length > 0,
    hasLines: pendingReceiptLines.length > 0,
  });
  const transitionReason = transition.allowed ? null : transition.reason;
  const canWrite = can(ctx.membership.role, "purchase.write");
  const canEdit =
    canWrite &&
    receipts.length === 0 &&
    invoices.length === 0 &&
    !["RECEIVED", "INVOICED", "PAID", "VOID", "CANCELLED"].includes(
      record.status,
    );
  return (
    <PageShell>
      <PageHeader
        eyebrow="Pedido de compra"
        title={record.number}
        description={`${record.supplierName} · ${formatDate(record.createdAt)}`}
        backHref="/purchases/orders"
        backLabel="Volver a pedidos"
        meta={
          <StatusBadge tone={purchaseOrderStatusTone(record.status)}>
            {statusLabel(purchaseOrderStatusLabels, record.status)}
          </StatusBadge>
        }
        actions={
          <>
            <a
              className={buttonVariants({ variant: "outline" })}
              href={`/api/purchases/${record.id}/pdf`}
              rel="noreferrer"
              target="_blank"
            >
              <Download className="size-4" />
              PDF
            </a>
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/suppliers/${record.supplierPartnerId}`}
            >
              Ver proveedor
            </Link>
            {canEdit ? (
              <Link
                className={buttonVariants({ variant: "outline" })}
                href={`/purchases/${record.id}/edit`}
              >
                Editar
              </Link>
            ) : null}
            {canWrite && transition.allowed ? (
              <ReceivePurchaseButton
                lines={pendingReceiptLines}
                orderId={record.id}
                warehouses={warehouses}
              />
            ) : null}
          </>
        }
      />
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard
          label="Importe pedido"
          value={formatMoney(total, ctx.company.baseCurrencyCode)}
          helper={`${lines.length} líneas`}
        />
        <MetricCard
          label="Recepciones"
          value={receipts.length}
          helper={
            receipts[0] ? formatDate(receipts[0].receivedAt) : "Pendiente"
          }
          tone={receipts.length > 0 ? "success" : "warning"}
        />
        <MetricCard
          label="Facturas"
          value={invoices.length}
          helper={
            invoices.length > 0
              ? formatMoney(
                  invoices.reduce(
                    (sum, row) => sum + Number(row.totalAmount),
                    0,
                  ),
                  ctx.company.baseCurrencyCode,
                )
              : "Pendiente"
          }
        />
        <MetricCard
          label="Pagado"
          value={formatMoney(paid, ctx.company.baseCurrencyCode)}
          helper={`${payments.length} pagos`}
          tone={paid >= total && total > 0 ? "success" : "neutral"}
        />
      </section>
      <PageSection
        title="Líneas del pedido"
        description="Productos, cantidades y precios acordados."
      >
        <div className="overflow-x-auto rounded-[2px] border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium">
                    {line.description}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(line.quantity).toLocaleString("es-ES")}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoney(line.unitPrice, ctx.company.baseCurrencyCode)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatMoney(line.lineTotal, ctx.company.baseCurrencyCode)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PageSection>
      <section className="grid gap-4 lg:grid-cols-2">
        <PageSection
          title="Recepciones"
          description="Entradas de mercancía vinculadas."
          contentClassName="space-y-2"
        >
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {transitionReason ?? "Pendiente de recepción."}
            </p>
          ) : (
            receipts.map((receipt) => (
              <Link
                className="block rounded-[2px] border p-3 text-sm hover:bg-accent"
                href={`/purchases/receipts/${receipt.id}`}
                key={receipt.id}
              >
                <p className="font-medium">
                  Recepción {receipt.id.slice(0, 8)}
                </p>
                <p className="text-muted-foreground">
                  {formatDate(receipt.receivedAt)}
                </p>
              </Link>
            ))
          )}
        </PageSection>
        <PageSection
          title="Facturas y pagos"
          description="Documentos recibidos desde este pedido."
          contentClassName="space-y-2"
        >
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no se ha generado factura de proveedor.
            </p>
          ) : (
            invoices.map((invoice) => (
              <Link
                className="flex items-center justify-between rounded-[2px] border p-3 text-sm hover:bg-accent"
                href={`/expenses/${invoice.id}`}
                key={invoice.id}
              >
                <span>
                  <span className="font-medium">
                    {invoice.supplierDocumentNumber ?? invoice.number}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {statusLabel(
                      invoicePaymentStatusLabels,
                      invoice.paymentStatus,
                    )}
                  </span>
                </span>
                <span className="font-mono font-semibold">
                  {formatMoney(
                    invoice.totalAmount,
                    ctx.company.baseCurrencyCode,
                  )}
                </span>
              </Link>
            ))
          )}
        </PageSection>
      </section>
    </PageShell>
  );
}
