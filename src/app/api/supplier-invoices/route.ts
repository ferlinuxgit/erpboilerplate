import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { goodsReceipt, goodsReceiptLine, partner, purchaseOrder, purchaseOrderLine, supplierInvoice, supplierInvoiceLine } from "@/db/schema";
import { getUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { invalidJsonResponse, readJsonBody } from "@/lib/http";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { postSupplierInvoice } from "@/server/accounting/auto-post";
import { reserveSeriesNumber } from "@/server/documents/series";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";

const payloadSchema = z.object({
  supplierPartnerId: z.string().trim().min(1),
  purchaseOrderId: z.string().trim().min(1),
  goodsReceiptId: z.string().trim().min(1),
  number: z.string().trim().optional().or(z.literal("")),
  issueDate: z.string().datetime().optional(),
  lines: z.array(
    z.object({
      itemId: z.string().trim().optional().or(z.literal("")),
      description: z.string().trim().min(1),
      quantity: z.number().positive(),
      unitPrice: z.number().nonnegative(),
      taxRate: z.number().min(0).max(100).default(21),
    }),
  ).min(1),
});

export async function GET() {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "purchase.read")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });
  return NextResponse.json(await db.select().from(supplierInvoice).where(eq(supplierInvoice.companyId, ctx.company.id)));
}

export async function POST(request: Request) {
  const session = await getUserSession();
  if (!session?.user) return NextResponse.json({ message: "No autorizado." }, { status: 401 });
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "purchase.write")) return NextResponse.json({ message: "Sin permisos." }, { status: 403 });

  const payload = await readJsonBody(request);
  if (!payload) return invalidJsonResponse();

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ message: "Datos inválidos." }, { status: 400 });

  const [ownedSupplier] = await db
    .select({ id: partner.id })
    .from(partner)
    .where(and(eq(partner.id, parsed.data.supplierPartnerId), eq(partner.companyId, ctx.company.id)))
    .limit(1);
  if (!ownedSupplier) return NextResponse.json({ message: "Proveedor no encontrado." }, { status: 404 });

  const [ownedOrder] = await db
    .select({ id: purchaseOrder.id, supplierPartnerId: purchaseOrder.supplierPartnerId })
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.id, parsed.data.purchaseOrderId), eq(purchaseOrder.companyId, ctx.company.id)))
    .limit(1);
  if (!ownedOrder) return NextResponse.json({ message: "Pedido de compra no encontrado." }, { status: 404 });
  if (ownedOrder.supplierPartnerId !== parsed.data.supplierPartnerId) {
    return NextResponse.json({ message: "El proveedor no coincide con el pedido de compra." }, { status: 400 });
  }

  const [ownedReceipt] = await db
    .select({ id: goodsReceipt.id, purchaseOrderId: goodsReceipt.purchaseOrderId })
    .from(goodsReceipt)
    .where(eq(goodsReceipt.id, parsed.data.goodsReceiptId))
    .limit(1);
  if (!ownedReceipt || ownedReceipt.purchaseOrderId !== parsed.data.purchaseOrderId) {
    return NextResponse.json({ message: "Albarán de recepción inválido para ese pedido." }, { status: 400 });
  }

  const poLines = await db
    .select({ itemId: purchaseOrderLine.itemId, quantity: purchaseOrderLine.quantity })
    .from(purchaseOrderLine)
    .where(eq(purchaseOrderLine.purchaseOrderId, parsed.data.purchaseOrderId));
  const receiptLines = await db
    .select({ itemId: goodsReceiptLine.itemId, quantity: goodsReceiptLine.quantity })
    .from(goodsReceiptLine)
    .where(eq(goodsReceiptLine.goodsReceiptId, parsed.data.goodsReceiptId));

  const poQtyByItem = new Map<string, number>();
  for (const line of poLines) {
    if (!line.itemId) continue;
    poQtyByItem.set(line.itemId, (poQtyByItem.get(line.itemId) ?? 0) + Number(line.quantity));
  }

  const receiptQtyByItem = new Map<string, number>();
  for (const line of receiptLines) {
    if (!line.itemId) continue;
    receiptQtyByItem.set(line.itemId, (receiptQtyByItem.get(line.itemId) ?? 0) + Number(line.quantity));
  }

  for (const line of parsed.data.lines) {
    if (!line.itemId) continue;
    const poQty = poQtyByItem.get(line.itemId) ?? 0;
    const receiptQty = receiptQtyByItem.get(line.itemId) ?? 0;
    if (line.quantity > poQty) {
      return NextResponse.json({ message: "La cantidad facturada supera la cantidad del pedido." }, { status: 400 });
    }
    if (line.quantity > receiptQty) {
      return NextResponse.json({ message: "La cantidad facturada supera la cantidad recepcionada." }, { status: 400 });
    }
  }

  try {
    const created = await db.transaction(async (tx) => {
      const number =
        parsed.data.number?.trim() ||
        (await reserveSeriesNumber(tx, {
          companyId: ctx.company.id,
          fiscalYearId: ctx.fiscalYear.id,
          type: "SUPPLIER_INVOICE",
        }));

      const issueDate = parsed.data.issueDate ? new Date(parsed.data.issueDate) : new Date();
      await assertFiscalPeriodOpen(ctx.company.id, issueDate, tx);

      const subtotal = parsed.data.lines.reduce((acc, line) => acc + line.quantity * line.unitPrice, 0);
      const taxAmount = parsed.data.lines.reduce((acc, line) => acc + (line.quantity * line.unitPrice * line.taxRate) / 100, 0);
      const totalAmount = subtotal + taxAmount;
      const [header] = await tx.insert(supplierInvoice).values({
        companyId: ctx.company.id,
        supplierPartnerId: parsed.data.supplierPartnerId,
        purchaseOrderId: parsed.data.purchaseOrderId,
        goodsReceiptId: parsed.data.goodsReceiptId,
        number,
        issueDate,
        totalAmount: totalAmount.toFixed(2),
      }).returning();

      await tx.insert(supplierInvoiceLine).values(
        parsed.data.lines.map((line) => ({
          supplierInvoiceId: header.id,
          itemId: line.itemId || null,
          description: line.description,
          quantity: line.quantity.toFixed(3),
          unitPrice: line.unitPrice.toFixed(2),
          taxRate: line.taxRate.toFixed(3),
          lineTotal: (line.quantity * line.unitPrice * (1 + line.taxRate / 100)).toFixed(2),
        })),
      );

      await postSupplierInvoice({
        tenantId: ctx.tenant.id,
        companyId: ctx.company.id,
        actorUserId: session.user.id,
        supplierInvoiceId: header.id,
        postedAt: new Date(),
        reference: `Factura proveedor ${header.number}`,
        subtotal,
        taxAmount,
        totalAmount,
        dbClient: tx,
      });

      return header;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo crear la factura proveedor.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
