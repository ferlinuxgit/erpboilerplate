import Link from "next/link";

import { PurchaseReceiptsList } from "@/components/purchases/purchase-receipts-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { eq } from "drizzle-orm";
import { goodsReceipt, goodsReceiptLine, purchaseOrder } from "@/db/schema";
import { requireContext } from "@/lib/current-context";
import { db } from "@/lib/db";
import { can } from "@/lib/rbac";
import { listPurchasePipeline } from "@/server/purchases/service";

export default async function PurchaseReceiptsPage() {
  const ctx = await requireContext("purchase.read");
  const canWrite = can(ctx.membership.role, "purchase.write");
  const [{ orders, receipts, invoices }, receiptLines] = await Promise.all([
    listPurchasePipeline(ctx.company.id),
    db
      .select({
        receiptId: goodsReceiptLine.goodsReceiptId,
        quantity: goodsReceiptLine.quantity,
      })
      .from(goodsReceiptLine)
      .innerJoin(
        goodsReceipt,
        eq(goodsReceipt.id, goodsReceiptLine.goodsReceiptId),
      )
      .innerJoin(
        purchaseOrder,
        eq(purchaseOrder.id, goodsReceipt.purchaseOrderId),
      )
      .where(eq(purchaseOrder.companyId, ctx.company.id)),
  ]);
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const invoiceByReceipt = new Map(
    invoices
      .filter((invoice) => invoice.goodsReceiptId)
      .map((invoice) => [invoice.goodsReceiptId as string, invoice.id]),
  );
  const rows = receipts.map((receipt) => {
    const order = orderById.get(receipt.purchaseOrderId);
    const lines = receiptLines.filter((line) => line.receiptId === receipt.id);
    return {
      id: receipt.id,
      number: receipt.number,
      orderId: receipt.purchaseOrderId,
      orderNumber: order?.number ?? "Pedido",
      supplierName: order?.supplierName ?? "Proveedor",
      receivedAt: receipt.receivedAt,
      lineCount: lines.length,
      totalQuantity: lines.reduce(
        (total, line) => total + Number(line.quantity),
        0,
      ),
      invoiceId: invoiceByReceipt.get(receipt.id) ?? null,
    };
  });
  return (
    <PageShell>
      <PageHeader
        eyebrow="Recepciones"
        title="Recepciones"
        description="Entradas de mercancía vinculadas a pedidos y su estado de facturación."
        actions={
          canWrite ? (
            <Link className={buttonVariants()} href="/purchases/orders">
              Recepcionar un pedido
            </Link>
          ) : null
        }
      />
      <PageSection
        title="Recepciones registradas"
        description="Cada recepción conserva sus cantidades y el documento de proveedor relacionado."
      >
        <PurchaseReceiptsList rows={rows} />
      </PageSection>
    </PageShell>
  );
}
