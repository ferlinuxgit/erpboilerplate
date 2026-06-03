import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  accountChart,
  companySettings,
  goodsReceipt,
  goodsReceiptLine,
  partner,
  purchaseOrder,
  purchaseOrderLine,
  supplierInvoice,
  supplierInvoiceAttachment,
  supplierInvoiceLine,
  supplierInvoicePayment,
} from "@/db/schema";
import { db, type AppDbTransaction, type DbClient } from "@/lib/db";
import { normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
import { postSupplierInvoice, reverseSupplierInvoice } from "@/server/accounting/auto-post";
import { recordAudit } from "@/server/audit";
import { reserveSeriesNumber } from "@/server/documents/series";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";

export type SupplierInvoiceOrigin = "PURCHASE" | "EXPENSE";

export type SupplierInvoiceLineInput = {
  itemId?: string;
  expenseAccountId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  taxDeductiblePct?: number;
  retentionRate?: number;
};

export type SupplierInvoiceAttachmentInput = {
  fileName: string;
  fileUrl: string;
  storageKey?: string;
  contentType?: string;
  sizeBytes?: number;
};

export type CreatePurchaseSupplierInvoiceInput = {
  tenantId: string;
  companyId: string;
  fiscalYearId: string;
  actorUserId: string;
  supplierPartnerId: string;
  purchaseOrderId: string;
  goodsReceiptId: string;
  number?: string;
  supplierDocumentNumber?: string;
  issueDate?: Date;
  dueDate?: Date;
  notes?: string;
  lines: SupplierInvoiceLineInput[];
  attachments?: SupplierInvoiceAttachmentInput[];
};

export type CreateExpenseInvoiceInput = {
  tenantId: string;
  companyId: string;
  fiscalYearId: string;
  actorUserId: string;
  supplierPartnerId?: string;
  supplierName?: string;
  supplierTaxId?: string;
  number?: string;
  supplierDocumentNumber?: string;
  issueDate: Date;
  dueDate?: Date;
  notes?: string;
  lines: SupplierInvoiceLineInput[];
  attachments?: SupplierInvoiceAttachmentInput[];
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clampPct(value: number | undefined, fallback: number) {
  const pct = value ?? fallback;
  if (!Number.isFinite(pct)) return fallback;
  return Math.min(Math.max(pct, 0), 100);
}

function assertValidLines(lines: SupplierInvoiceLineInput[]) {
  if (lines.length === 0) throw new Error("La factura necesita al menos una linea.");
  for (const line of lines) {
    if (!line.description.trim()) throw new Error("Todas las lineas necesitan descripcion.");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error("La cantidad debe ser mayor que cero.");
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) throw new Error("El precio unitario no puede ser negativo.");
  }
}

function sanitizeAttachments(attachments: SupplierInvoiceAttachmentInput[] | undefined) {
  return (attachments ?? [])
    .map((attachment) => ({
      fileName: attachment.fileName.trim(),
      fileUrl: attachment.fileUrl.trim(),
      storageKey: attachment.storageKey?.trim() || null,
      contentType: attachment.contentType?.trim() || null,
      sizeBytes: attachment.sizeBytes && Number.isFinite(attachment.sizeBytes) ? Math.max(Math.trunc(attachment.sizeBytes), 0) : null,
    }))
    .filter((attachment) => attachment.fileName && attachment.fileUrl)
    .slice(0, 10);
}

function buildLineValues(invoiceId: string, lines: SupplierInvoiceLineInput[], fallbackExpenseAccountId?: string) {
  return lines.map((line) => {
    const quantity = line.quantity;
    const unitPrice = line.unitPrice;
    const taxRate = clampPct(line.taxRate, 21);
    const taxDeductiblePct = clampPct(line.taxDeductiblePct, 100);
    const retentionRate = clampPct(line.retentionRate, 0);
    const subtotalAmount = roundMoney(quantity * unitPrice);
    const taxAmount = roundMoney((subtotalAmount * taxRate) / 100);
    const retentionAmount = roundMoney((subtotalAmount * retentionRate) / 100);
    const lineTotal = roundMoney(subtotalAmount + taxAmount - retentionAmount);

    return {
      supplierInvoiceId: invoiceId,
      itemId: line.itemId || null,
      expenseAccountId: line.expenseAccountId || fallbackExpenseAccountId || null,
      description: line.description.trim(),
      quantity: quantity.toFixed(3),
      unitPrice: unitPrice.toFixed(2),
      taxRate: taxRate.toFixed(3),
      taxDeductiblePct: taxDeductiblePct.toFixed(3),
      retentionRate: retentionRate.toFixed(3),
      subtotalAmount: subtotalAmount.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      retentionAmount: retentionAmount.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
    };
  });
}

function calculateTotals(lines: ReturnType<typeof buildLineValues>) {
  return {
    subtotalAmount: roundMoney(lines.reduce((total, line) => total + Number(line.subtotalAmount), 0)),
    taxAmount: roundMoney(lines.reduce((total, line) => total + Number(line.taxAmount), 0)),
    retentionAmount: roundMoney(lines.reduce((total, line) => total + Number(line.retentionAmount), 0)),
    totalAmount: roundMoney(lines.reduce((total, line) => total + Number(line.lineTotal), 0)),
  };
}

async function getDefaultExpenseAccountId(companyId: string, client: DbClient) {
  const [settings] = await client
    .select({ defaultPurchaseAccountCode: companySettings.defaultPurchaseAccountCode })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  const defaultCode = settings?.defaultPurchaseAccountCode ?? "600000";
  const [defaultAccount] = await client
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.code, defaultCode)))
    .limit(1);
  if (defaultAccount) return defaultAccount.id;

  const [firstExpenseAccount] = await client
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.type, "EXPENSE")))
    .limit(1);
  return firstExpenseAccount?.id;
}

async function assertExpenseAccountsBelongToCompany(companyId: string, accountIds: string[], client: DbClient) {
  const uniqueIds = [...new Set(accountIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;
  const rows = await client
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.id, uniqueIds)));
  if (rows.length !== uniqueIds.length) throw new Error("Cuenta de gasto invalida para la empresa activa.");
}

function partnerTypeForSupplier(currentType: "CUSTOMER" | "SUPPLIER" | "BOTH") {
  return currentType === "CUSTOMER" ? "BOTH" : currentType;
}

async function resolveSupplier(input: { companyId: string; supplierPartnerId?: string; supplierName?: string; supplierTaxId?: string; client: DbClient }) {
  if (input.supplierPartnerId) {
    const [existing] = await input.client
      .select({ id: partner.id })
      .from(partner)
      .where(and(eq(partner.id, input.supplierPartnerId), eq(partner.companyId, input.companyId)))
      .limit(1);
    if (!existing) throw new Error("Proveedor no encontrado.");
    return existing.id;
  }

  const supplierName = input.supplierName?.trim();
  const supplierTaxId = normalizeSpanishTaxId(input.supplierTaxId);

  if (supplierTaxId) {
    const [existingByTaxId] = await input.client
      .select({ id: partner.id, type: partner.type, name: partner.name })
      .from(partner)
      .where(and(eq(partner.companyId, input.companyId), eq(partner.taxId, supplierTaxId)))
      .limit(1);
    if (existingByTaxId) {
      await input.client
        .update(partner)
        .set({
          type: partnerTypeForSupplier(existingByTaxId.type),
          name: supplierName || existingByTaxId.name,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(and(eq(partner.id, existingByTaxId.id), eq(partner.companyId, input.companyId)));
      return existingByTaxId.id;
    }
  }

  if (!supplierName && !supplierTaxId) throw new Error("Indica un proveedor o su CIF/NIF.");
  const [existing] = supplierName
    ? await input.client
      .select({ id: partner.id, type: partner.type })
      .from(partner)
      .where(and(eq(partner.companyId, input.companyId), eq(partner.name, supplierName)))
      .limit(1)
    : [];
  if (existing) {
    await input.client
      .update(partner)
      .set({
        type: partnerTypeForSupplier(existing.type),
        ...(supplierTaxId ? { taxId: supplierTaxId } : {}),
        isActive: true,
        updatedAt: new Date(),
      })
      .where(and(eq(partner.id, existing.id), eq(partner.companyId, input.companyId)));
    return existing.id;
  }

  const [created] = await input.client
    .insert(partner)
    .values({ companyId: input.companyId, type: "SUPPLIER", name: supplierName || `Proveedor ${supplierTaxId}`, taxId: supplierTaxId || null })
    .returning({ id: partner.id });
  return created.id;
}

function getPaymentStatus(totalAmount: number, paidAmount: number, dueDate: Date | null | undefined) {
  if (paidAmount >= totalAmount && totalAmount > 0) return "PAID";
  if (paidAmount > 0) return "PARTIAL";
  if (dueDate && dueDate.getTime() < Date.now()) return "OVERDUE";
  return "PENDING";
}

async function createSupplierInvoiceHeader(input: {
  tenantId: string;
  companyId: string;
  fiscalYearId: string;
  actorUserId: string;
  origin: SupplierInvoiceOrigin;
  supplierPartnerId: string;
  purchaseOrderId?: string | null;
  goodsReceiptId?: string | null;
  number?: string;
  supplierDocumentNumber?: string;
  issueDate: Date;
  dueDate?: Date;
  notes?: string;
  lines: SupplierInvoiceLineInput[];
  attachments?: SupplierInvoiceAttachmentInput[];
  client: AppDbTransaction;
}) {
  assertValidLines(input.lines);
  await assertFiscalPeriodOpen(input.companyId, input.issueDate, input.client);
  const fallbackExpenseAccountId = await getDefaultExpenseAccountId(input.companyId, input.client);
  await assertExpenseAccountsBelongToCompany(
    input.companyId,
    input.lines.map((line) => line.expenseAccountId).filter((value): value is string => Boolean(value)),
    input.client,
  );

  const number =
    input.number?.trim() ||
    (await reserveSeriesNumber(input.client, {
      companyId: input.companyId,
      fiscalYearId: input.fiscalYearId,
      type: "SUPPLIER_INVOICE",
    }));

  const [header] = await input.client
    .insert(supplierInvoice)
    .values({
      companyId: input.companyId,
      supplierPartnerId: input.supplierPartnerId,
      purchaseOrderId: input.purchaseOrderId ?? null,
      goodsReceiptId: input.goodsReceiptId ?? null,
      origin: input.origin,
      number,
      supplierDocumentNumber: input.supplierDocumentNumber?.trim() || null,
      issueDate: input.issueDate,
      dueDate: input.dueDate ?? null,
      status: "POSTED",
      paymentStatus: getPaymentStatus(0, 0, input.dueDate),
      subtotalAmount: "0.00",
      taxAmount: "0.00",
      retentionAmount: "0.00",
      totalAmount: "0.00",
      notes: input.notes?.trim() || null,
    })
    .returning();

  const lineValues = buildLineValues(header.id, input.lines, fallbackExpenseAccountId);
  const totals = calculateTotals(lineValues);
  await input.client.insert(supplierInvoiceLine).values(lineValues);
  const attachments = sanitizeAttachments(input.attachments);
  if (attachments.length > 0) {
    await input.client.insert(supplierInvoiceAttachment).values(
      attachments.map((attachment) => ({
        supplierInvoiceId: header.id,
        companyId: input.companyId,
        ...attachment,
      })),
    );
  }
  const [updated] = await input.client
    .update(supplierInvoice)
    .set({
      subtotalAmount: totals.subtotalAmount.toFixed(2),
      taxAmount: totals.taxAmount.toFixed(2),
      retentionAmount: totals.retentionAmount.toFixed(2),
      totalAmount: totals.totalAmount.toFixed(2),
      paymentStatus: getPaymentStatus(totals.totalAmount, 0, input.dueDate),
      updatedAt: new Date(),
    })
    .where(and(eq(supplierInvoice.companyId, input.companyId), eq(supplierInvoice.id, header.id)))
    .returning();

  await postSupplierInvoice({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    supplierInvoiceId: header.id,
    postedAt: input.issueDate,
    reference: `Factura proveedor ${updated.number}`,
    subtotal: totals.subtotalAmount,
    taxAmount: totals.taxAmount,
    retentionAmount: totals.retentionAmount,
    totalAmount: totals.totalAmount,
    expenseLines: lineValues.map((line) => ({
      accountId: line.expenseAccountId ?? fallbackExpenseAccountId,
      subtotal: Number(line.subtotalAmount),
      taxAmount: Number(line.taxAmount),
      taxDeductiblePct: Number(line.taxDeductiblePct),
      retentionAmount: Number(line.retentionAmount),
    })),
    dbClient: input.client,
  });

  await recordAudit(
    {
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      action: input.origin === "EXPENSE" ? "expense.create" : "purchase.supplierInvoice.create",
      entityName: "supplierInvoice",
      entityId: header.id,
      payload: { origin: input.origin, totalAmount: totals.totalAmount, supplierDocumentNumber: input.supplierDocumentNumber },
    },
    input.client,
  );

  return updated;
}

export async function createPurchaseSupplierInvoice(input: CreatePurchaseSupplierInvoiceInput) {
  return db.transaction(async (tx) => {
    const [ownedOrder] = await tx
      .select({ id: purchaseOrder.id, supplierPartnerId: purchaseOrder.supplierPartnerId })
      .from(purchaseOrder)
      .where(and(eq(purchaseOrder.id, input.purchaseOrderId), eq(purchaseOrder.companyId, input.companyId)))
      .limit(1);
    if (!ownedOrder) throw new Error("Pedido de compra no encontrado.");
    if (ownedOrder.supplierPartnerId !== input.supplierPartnerId) throw new Error("El proveedor no coincide con el pedido de compra.");

    const [ownedReceipt] = await tx
      .select({ id: goodsReceipt.id, purchaseOrderId: goodsReceipt.purchaseOrderId })
      .from(goodsReceipt)
      .where(eq(goodsReceipt.id, input.goodsReceiptId))
      .limit(1);
    if (!ownedReceipt || ownedReceipt.purchaseOrderId !== input.purchaseOrderId) {
      throw new Error("Albaran de recepcion invalido para ese pedido.");
    }

    const poLines = await tx
      .select({ itemId: purchaseOrderLine.itemId, quantity: purchaseOrderLine.quantity })
      .from(purchaseOrderLine)
      .where(eq(purchaseOrderLine.purchaseOrderId, input.purchaseOrderId));
    const receiptLines = await tx
      .select({ itemId: goodsReceiptLine.itemId, quantity: goodsReceiptLine.quantity })
      .from(goodsReceiptLine)
      .where(eq(goodsReceiptLine.goodsReceiptId, input.goodsReceiptId));
    const poQtyByItem = new Map<string, number>();
    const receiptQtyByItem = new Map<string, number>();
    for (const line of poLines) if (line.itemId) poQtyByItem.set(line.itemId, (poQtyByItem.get(line.itemId) ?? 0) + Number(line.quantity));
    for (const line of receiptLines) if (line.itemId) receiptQtyByItem.set(line.itemId, (receiptQtyByItem.get(line.itemId) ?? 0) + Number(line.quantity));

    for (const line of input.lines) {
      if (!line.itemId) continue;
      if (line.quantity > (poQtyByItem.get(line.itemId) ?? 0)) throw new Error("La cantidad facturada supera la cantidad del pedido.");
      if (line.quantity > (receiptQtyByItem.get(line.itemId) ?? 0)) throw new Error("La cantidad facturada supera la cantidad recepcionada.");
    }

    return createSupplierInvoiceHeader({
      ...input,
      origin: "PURCHASE",
      issueDate: input.issueDate ?? new Date(),
      client: tx,
    });
  });
}

export async function createExpenseInvoice(input: CreateExpenseInvoiceInput) {
  return db.transaction(async (tx) => {
    const supplierPartnerId = await resolveSupplier({
      companyId: input.companyId,
      supplierPartnerId: input.supplierPartnerId,
      supplierName: input.supplierName,
      supplierTaxId: input.supplierTaxId,
      client: tx,
    });
    return createSupplierInvoiceHeader({
      ...input,
      origin: "EXPENSE",
      supplierPartnerId,
      purchaseOrderId: null,
      goodsReceiptId: null,
      client: tx,
    });
  });
}

export async function listExpenseInvoices(companyId: string) {
  const [invoices, payments] = await Promise.all([
    db
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
        supplierName: partner.name,
        issueDate: supplierInvoice.issueDate,
        dueDate: supplierInvoice.dueDate,
        status: supplierInvoice.status,
        paymentStatus: supplierInvoice.paymentStatus,
        subtotalAmount: supplierInvoice.subtotalAmount,
        taxAmount: supplierInvoice.taxAmount,
        retentionAmount: supplierInvoice.retentionAmount,
        totalAmount: supplierInvoice.totalAmount,
        notes: supplierInvoice.notes,
      })
      .from(supplierInvoice)
      .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
      .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.origin, "EXPENSE")))
      .orderBy(desc(supplierInvoice.issueDate)),
    db
      .select({
        supplierInvoiceId: supplierInvoicePayment.supplierInvoiceId,
        paidAmount: sql<string>`coalesce(sum(${supplierInvoicePayment.amountApplied}), '0')`,
      })
      .from(supplierInvoicePayment)
      .where(eq(supplierInvoicePayment.companyId, companyId))
      .groupBy(supplierInvoicePayment.supplierInvoiceId),
  ]);

  const paidByInvoice = new Map(payments.map((payment) => [payment.supplierInvoiceId, Number(payment.paidAmount)]));
  return invoices.map((invoice) => {
    const paidAmount = paidByInvoice.get(invoice.id) ?? 0;
    const totalAmount = Number(invoice.totalAmount);
    const paymentStatus = getPaymentStatus(totalAmount, paidAmount, invoice.dueDate);
    return {
      ...invoice,
      paidAmount: paidAmount.toFixed(2),
      outstandingAmount: Math.max(totalAmount - paidAmount, 0).toFixed(2),
      paymentStatus,
    };
  });
}

export async function listSupplierPartners(companyId: string) {
  return db
    .select({ id: partner.id, name: partner.name, taxId: partner.taxId })
    .from(partner)
    .where(and(eq(partner.companyId, companyId), inArray(partner.type, ["SUPPLIER", "BOTH"])))
    .orderBy(partner.name);
}

export async function getExpenseInvoice(companyId: string, id: string) {
  const [invoiceRow] = await db
    .select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      supplierPartnerId: supplierInvoice.supplierPartnerId,
      supplierName: partner.name,
      issueDate: supplierInvoice.issueDate,
      dueDate: supplierInvoice.dueDate,
      status: supplierInvoice.status,
      paymentStatus: supplierInvoice.paymentStatus,
      subtotalAmount: supplierInvoice.subtotalAmount,
      taxAmount: supplierInvoice.taxAmount,
      retentionAmount: supplierInvoice.retentionAmount,
      totalAmount: supplierInvoice.totalAmount,
      notes: supplierInvoice.notes,
      createdAt: supplierInvoice.createdAt,
      updatedAt: supplierInvoice.updatedAt,
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.id, id), eq(supplierInvoice.origin, "EXPENSE")))
    .limit(1);
  if (!invoiceRow) return null;

  const [lines, attachments, payments] = await Promise.all([
    db
      .select({
        id: supplierInvoiceLine.id,
        description: supplierInvoiceLine.description,
        quantity: supplierInvoiceLine.quantity,
        unitPrice: supplierInvoiceLine.unitPrice,
        taxRate: supplierInvoiceLine.taxRate,
        taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
        retentionRate: supplierInvoiceLine.retentionRate,
        subtotalAmount: supplierInvoiceLine.subtotalAmount,
        taxAmount: supplierInvoiceLine.taxAmount,
        retentionAmount: supplierInvoiceLine.retentionAmount,
        lineTotal: supplierInvoiceLine.lineTotal,
        expenseAccountId: supplierInvoiceLine.expenseAccountId,
        expenseAccountCode: accountChart.code,
        expenseAccountName: accountChart.name,
      })
      .from(supplierInvoiceLine)
      .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
      .where(eq(supplierInvoiceLine.supplierInvoiceId, id)),
    db
      .select({
        id: supplierInvoiceAttachment.id,
        fileName: supplierInvoiceAttachment.fileName,
        fileUrl: supplierInvoiceAttachment.fileUrl,
        storageKey: supplierInvoiceAttachment.storageKey,
        contentType: supplierInvoiceAttachment.contentType,
        sizeBytes: supplierInvoiceAttachment.sizeBytes,
        createdAt: supplierInvoiceAttachment.createdAt,
      })
      .from(supplierInvoiceAttachment)
      .where(and(eq(supplierInvoiceAttachment.companyId, companyId), eq(supplierInvoiceAttachment.supplierInvoiceId, id))),
    db
      .select({ amountApplied: supplierInvoicePayment.amountApplied })
      .from(supplierInvoicePayment)
      .where(and(eq(supplierInvoicePayment.companyId, companyId), eq(supplierInvoicePayment.supplierInvoiceId, id))),
  ]);
  const paidAmount = payments.reduce((total, payment) => total + Number(payment.amountApplied), 0);
  return {
    ...invoiceRow,
    paidAmount: paidAmount.toFixed(2),
    outstandingAmount: Math.max(Number(invoiceRow.totalAmount) - paidAmount, 0).toFixed(2),
    paymentStatus: getPaymentStatus(Number(invoiceRow.totalAmount), paidAmount, invoiceRow.dueDate),
    lines,
    attachments,
  };
}

export async function voidExpenseInvoice(input: { tenantId: string; companyId: string; actorUserId: string; id: string; reason?: string }) {
  return db.transaction(async (tx) => {
    const [invoiceRow] = await tx
      .select({
        id: supplierInvoice.id,
        origin: supplierInvoice.origin,
        status: supplierInvoice.status,
        number: supplierInvoice.number,
        subtotalAmount: supplierInvoice.subtotalAmount,
        taxAmount: supplierInvoice.taxAmount,
        retentionAmount: supplierInvoice.retentionAmount,
        totalAmount: supplierInvoice.totalAmount,
        issueDate: supplierInvoice.issueDate,
      })
      .from(supplierInvoice)
      .where(and(eq(supplierInvoice.companyId, input.companyId), eq(supplierInvoice.id, input.id), eq(supplierInvoice.origin, "EXPENSE")))
      .limit(1);
    if (!invoiceRow) return null;
    if (invoiceRow.status === "VOID") throw new Error("La factura de gasto ya esta anulada.");

    const paymentRows = await tx
      .select({ amountApplied: supplierInvoicePayment.amountApplied })
      .from(supplierInvoicePayment)
      .where(and(eq(supplierInvoicePayment.companyId, input.companyId), eq(supplierInvoicePayment.supplierInvoiceId, input.id)));
    const paidAmount = paymentRows.reduce((total, payment) => total + Number(payment.amountApplied), 0);
    if (paidAmount > 0) throw new Error("No se puede anular un gasto con pagos registrados. Anula o corrige el pago primero.");

    const lineRows = await tx
      .select({
        expenseAccountId: supplierInvoiceLine.expenseAccountId,
        subtotalAmount: supplierInvoiceLine.subtotalAmount,
        taxAmount: supplierInvoiceLine.taxAmount,
        taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
        retentionAmount: supplierInvoiceLine.retentionAmount,
      })
      .from(supplierInvoiceLine)
      .where(eq(supplierInvoiceLine.supplierInvoiceId, input.id));

    await reverseSupplierInvoice({
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      supplierInvoiceId: input.id,
      postedAt: new Date(),
      reference: `Anulacion factura gasto ${invoiceRow.number}`,
      subtotal: Number(invoiceRow.subtotalAmount),
      taxAmount: Number(invoiceRow.taxAmount),
      retentionAmount: Number(invoiceRow.retentionAmount),
      totalAmount: Number(invoiceRow.totalAmount),
      expenseLines: lineRows.map((line) => ({
        accountId: line.expenseAccountId,
        subtotal: Number(line.subtotalAmount),
        taxAmount: Number(line.taxAmount),
        taxDeductiblePct: Number(line.taxDeductiblePct),
        retentionAmount: Number(line.retentionAmount),
      })),
      dbClient: tx,
    });

    const [updated] = await tx
      .update(supplierInvoice)
      .set({ status: "VOID", paymentStatus: "VOID", notes: input.reason?.trim() || undefined, updatedAt: new Date() })
      .where(and(eq(supplierInvoice.companyId, input.companyId), eq(supplierInvoice.id, input.id)))
      .returning();

    await recordAudit(
      {
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "expense.void",
        entityName: "supplierInvoice",
        entityId: input.id,
        payload: { reason: input.reason, reversalPosted: true },
      },
      tx,
    );

    return updated;
  });
}

export async function refreshSupplierInvoicePaymentStatus(companyId: string, supplierInvoiceId: string, client: DbClient = db) {
  const [invoiceRow] = await client
    .select({ id: supplierInvoice.id, totalAmount: supplierInvoice.totalAmount, dueDate: supplierInvoice.dueDate })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.id, supplierInvoiceId)))
    .limit(1);
  if (!invoiceRow) return null;

  const [paymentRow] = await client
    .select({ paidAmount: sql<string>`coalesce(sum(${supplierInvoicePayment.amountApplied}), '0')` })
    .from(supplierInvoicePayment)
    .where(and(eq(supplierInvoicePayment.companyId, companyId), eq(supplierInvoicePayment.supplierInvoiceId, supplierInvoiceId)));
  const paymentStatus = getPaymentStatus(Number(invoiceRow.totalAmount), Number(paymentRow?.paidAmount ?? 0), invoiceRow.dueDate);
  const [updated] = await client
    .update(supplierInvoice)
    .set({ paymentStatus, updatedAt: new Date() })
    .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.id, supplierInvoiceId)))
    .returning();
  return updated;
}
