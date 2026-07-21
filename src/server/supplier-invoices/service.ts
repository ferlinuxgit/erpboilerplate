import { and, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";

import {
  accountChart,
  company,
  companySettings,
  expenseOcrJob,
  goodsReceipt,
  goodsReceiptLine,
  partner,
  purchaseOrder,
  purchaseOrderLine,
  supplierInvoice,
  supplierInvoiceAttachment,
  supplierInvoiceLine,
  supplierInvoicePayment,
  supplierPayment,
} from "@/db/schema";
import { db, type AppDbTransaction, type DbClient } from "@/lib/db";
import { buildSupplierIdentityKey, normalizeSupplierDocumentNumber, normalizeTaxIdentity } from "@/lib/expense-dedup";
import { normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
import { postSupplierInvoice, reverseAutomaticEntries } from "@/server/accounting/auto-post";
import { recordAudit } from "@/server/audit";
import { reserveSeriesNumber } from "@/server/documents/series";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import { reservePartnerNumber } from "@/server/partners/numbers";

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
  currencyCode?: string;
  idempotencyKey?: string;
};

export type CreateExpenseInvoiceInput = {
  tenantId: string;
  companyId: string;
  fiscalYearId: string;
  actorUserId: string;
  supplierPartnerId?: string;
  supplierName?: string;
  supplierTaxId?: string;
  supplierEmail?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  supplierAddressLine2?: string;
  supplierPostalCode?: string;
  supplierCity?: string;
  supplierProvince?: string;
  supplierCountryCode?: string;
  number?: string;
  supplierDocumentNumber?: string;
  issueDate: Date;
  dueDate?: Date;
  notes?: string;
  lines: SupplierInvoiceLineInput[];
  attachments?: SupplierInvoiceAttachmentInput[];
  ocrJobId?: string;
  currencyCode?: string;
  idempotencyKey?: string;
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
  if (lines.length === 0) throw new Error("La factura necesita al menos una línea.");
  for (const line of lines) {
    if (!line.description.trim()) throw new Error("Todas las líneas necesitan descripción.");
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

async function assertNoDuplicateExpenseInvoice(input: {
  companyId: string;
  supplierDocumentNumber?: string;
  documentSha256?: string | null;
  supplierIdentityKey: string;
  client: DbClient;
}) {
  if (input.documentSha256) {
    const [duplicateByFile] = await input.client
      .select({ id: supplierInvoice.id, number: supplierInvoice.number })
      .from(supplierInvoice)
      .where(and(
        eq(supplierInvoice.companyId, input.companyId),
        eq(supplierInvoice.documentSha256, input.documentSha256),
        ne(supplierInvoice.status, "VOID"),
      ))
      .limit(1);
    if (duplicateByFile) throw new Error(`Gasto duplicado: este archivo ya está asociado a ${duplicateByFile.number}.`);
  }

  const supplierDocumentNumber = input.supplierDocumentNumber?.trim();
  const normalizedNumber = normalizeSupplierDocumentNumber(supplierDocumentNumber);
  if (normalizedNumber) {
    const [duplicateByNumber] = await input.client
      .select({ id: supplierInvoice.id, number: supplierInvoice.number })
      .from(supplierInvoice)
      .where(and(
        eq(supplierInvoice.companyId, input.companyId),
        eq(supplierInvoice.supplierIdentityKey, input.supplierIdentityKey),
        eq(supplierInvoice.supplierDocumentNumberNormalized, normalizedNumber),
        ne(supplierInvoice.status, "VOID"),
      ))
      .limit(1);
    if (duplicateByNumber) {
      throw new Error(`Gasto duplicado: ya existe una factura de este proveedor con número ${supplierDocumentNumber}.`);
    }
  }
}

async function getDefaultExpenseAccountId(companyId: string, client: DbClient) {
  const [settings] = await client
    .select({ defaultPurchaseAccountCode: companySettings.defaultPurchaseAccountCode })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);
  const defaultCode = settings?.defaultPurchaseAccountCode ?? "600";
  const [defaultAccount] = await client
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.code, defaultCode), eq(accountChart.isPostable, true)))
    .limit(1);
  if (defaultAccount) return defaultAccount.id;

  const [firstExpenseAccount] = await client
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), eq(accountChart.type, "EXPENSE"), eq(accountChart.isPostable, true)))
    .limit(1);
  return firstExpenseAccount?.id;
}

async function assertExpenseAccountsBelongToCompany(companyId: string, accountIds: string[], client: DbClient) {
  const uniqueIds = [...new Set(accountIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;
  const rows = await client
    .select({ id: accountChart.id })
    .from(accountChart)
    .where(and(eq(accountChart.companyId, companyId), inArray(accountChart.id, uniqueIds), eq(accountChart.isPostable, true)));
  if (rows.length !== uniqueIds.length) throw new Error("Cuenta de gasto invalida para la empresa activa.");
}

function partnerTypeForSupplier(currentType: "CUSTOMER" | "SUPPLIER" | "BOTH") {
  return currentType === "CUSTOMER" ? "BOTH" : currentType;
}

function cleanOptional(value: string | null | undefined) {
  return value?.trim() || null;
}

function normalizeCountryCode(value: string | null | undefined) {
  return (value?.trim() || "ES").toUpperCase();
}

async function resolveSupplier(input: {
  companyId: string;
  supplierPartnerId?: string;
  supplierName?: string;
  supplierTaxId?: string;
  supplierEmail?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  supplierAddressLine2?: string;
  supplierPostalCode?: string;
  supplierCity?: string;
  supplierProvince?: string;
  supplierCountryCode?: string;
  client: DbClient;
}) {
  if (input.supplierPartnerId) {
    const [existing] = await input.client
      .select({ id: partner.id, name: partner.name, taxId: partner.taxId, countryCode: partner.countryCode, type: partner.type })
      .from(partner)
      .where(and(eq(partner.id, input.supplierPartnerId), eq(partner.companyId, input.companyId)))
      .limit(1);
    if (!existing) throw new Error("Proveedor no encontrado.");
    if (existing.type === "CUSTOMER") {
      await input.client.update(partner).set({ type: "BOTH", isActive: true, updatedAt: new Date() }).where(eq(partner.id, existing.id));
    }
    return { id: existing.id, identityKey: buildSupplierIdentityKey({ partnerId: existing.id, name: existing.name, taxId: existing.taxId, countryCode: existing.countryCode }) };
  }

  const supplierName = input.supplierName?.trim();
  const supplierTaxId = normalizeSpanishTaxId(input.supplierTaxId);
  const supplierCountryCode = cleanOptional(input.supplierCountryCode);
  const supplierDetails = {
    ...(cleanOptional(input.supplierEmail) ? { email: cleanOptional(input.supplierEmail) } : {}),
    ...(cleanOptional(input.supplierPhone) ? { phone: cleanOptional(input.supplierPhone) } : {}),
    ...(cleanOptional(input.supplierAddress) ? { address: cleanOptional(input.supplierAddress) } : {}),
    ...(cleanOptional(input.supplierAddressLine2) ? { addressLine2: cleanOptional(input.supplierAddressLine2) } : {}),
    ...(cleanOptional(input.supplierPostalCode) ? { postalCode: cleanOptional(input.supplierPostalCode) } : {}),
    ...(cleanOptional(input.supplierCity) ? { city: cleanOptional(input.supplierCity) } : {}),
    ...(cleanOptional(input.supplierProvince) ? { province: cleanOptional(input.supplierProvince) } : {}),
    ...(supplierCountryCode ? { countryCode: normalizeCountryCode(supplierCountryCode) } : {}),
  };

  if (supplierTaxId) {
    const normalizedCountry = normalizeCountryCode(supplierCountryCode);
    const normalizedTaxId = normalizeTaxIdentity(supplierTaxId, normalizedCountry);
    const [existingByTaxId] = await input.client
      .select({ id: partner.id, type: partner.type, name: partner.name })
      .from(partner)
      .where(and(
        eq(partner.companyId, input.companyId),
        eq(partner.countryCode, normalizedCountry),
        eq(partner.taxIdNormalized, normalizedTaxId),
      ))
      .limit(1);
    if (existingByTaxId) {
      await input.client
        .update(partner)
        .set({
          type: partnerTypeForSupplier(existingByTaxId.type),
          isActive: true,
          updatedAt: new Date(),
        })
        .where(and(eq(partner.id, existingByTaxId.id), eq(partner.companyId, input.companyId)));
      return { id: existingByTaxId.id, identityKey: buildSupplierIdentityKey({ partnerId: existingByTaxId.id, name: existingByTaxId.name, taxId: supplierTaxId, countryCode: normalizedCountry }) };
    }
  }

  if (!supplierName && !supplierTaxId) throw new Error("Indica un proveedor o su CIF/NIF.");
  const [existing] = supplierName
    ? await input.client
      .select({ id: partner.id, name: partner.name, type: partner.type })
      .from(partner)
      .where(and(eq(partner.companyId, input.companyId), eq(partner.name, supplierName)))
      .limit(1)
    : [];
  if (existing) {
    await input.client
      .update(partner)
      .set({
        type: partnerTypeForSupplier(existing.type),
        ...(supplierTaxId ? { taxId: supplierTaxId, taxIdNormalized: normalizeTaxIdentity(supplierTaxId, supplierCountryCode) } : {}),
        isActive: true,
        updatedAt: new Date(),
      })
      .where(and(eq(partner.id, existing.id), eq(partner.companyId, input.companyId)));
    return { id: existing.id, identityKey: buildSupplierIdentityKey({ partnerId: existing.id, name: existing.name, taxId: supplierTaxId, countryCode: supplierCountryCode }) };
  }

  const [created] = await input.client
    .insert(partner)
    .values({
      companyId: input.companyId,
      number: await reservePartnerNumber(input.client, input.companyId, "SUPPLIER"),
      type: "SUPPLIER",
      name: supplierName || `Proveedor ${supplierTaxId}`,
      taxId: supplierTaxId || null,
      taxIdNormalized: supplierTaxId ? normalizeTaxIdentity(supplierTaxId, supplierCountryCode) : null,
      countryCode: supplierCountryCode ? normalizeCountryCode(supplierCountryCode) : "ES",
      ...supplierDetails,
    })
    .onConflictDoNothing()
    .returning({ id: partner.id, name: partner.name });
  if (!created && supplierTaxId) {
    const [concurrent] = await input.client
      .select({ id: partner.id, name: partner.name })
      .from(partner)
      .where(and(
        eq(partner.companyId, input.companyId),
        eq(partner.countryCode, normalizeCountryCode(supplierCountryCode)),
        eq(partner.taxIdNormalized, normalizeTaxIdentity(supplierTaxId, supplierCountryCode)),
      ))
      .limit(1);
    if (concurrent) return { id: concurrent.id, identityKey: buildSupplierIdentityKey({ partnerId: concurrent.id, name: concurrent.name, taxId: supplierTaxId, countryCode: supplierCountryCode }) };
  }
  if (!created) throw new Error("No se pudo resolver el proveedor de forma concurrente.");
  return { id: created.id, identityKey: buildSupplierIdentityKey({ partnerId: created.id, name: created.name, taxId: supplierTaxId, countryCode: supplierCountryCode }) };
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
  supplierIdentityKey?: string;
  documentSha256?: string | null;
  idempotencyKey?: string;
  currencyCode?: string;
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
  const [supplierIdentity] = input.supplierIdentityKey
    ? []
    : await input.client
      .select({ name: partner.name, taxId: partner.taxId, countryCode: partner.countryCode })
      .from(partner)
      .where(and(eq(partner.id, input.supplierPartnerId), eq(partner.companyId, input.companyId)))
      .limit(1);
  const supplierIdentityKey = input.supplierIdentityKey ?? buildSupplierIdentityKey({
    partnerId: input.supplierPartnerId,
    name: supplierIdentity?.name,
    taxId: supplierIdentity?.taxId,
    countryCode: supplierIdentity?.countryCode,
  });
  const supplierDocumentNumber = input.supplierDocumentNumber?.trim() || null;
  const supplierDocumentNumberNormalized = normalizeSupplierDocumentNumber(supplierDocumentNumber) || null;
  const [ownedCompany] = await input.client
    .select({ baseCurrencyCode: company.baseCurrencyCode })
    .from(company)
    .where(eq(company.id, input.companyId))
    .limit(1);
  if (!ownedCompany) throw new Error("Empresa activa no encontrada.");
  const currencyCode = input.currencyCode?.trim().toUpperCase() || ownedCompany.baseCurrencyCode;
  if (currencyCode !== ownedCompany.baseCurrencyCode) {
    throw new Error(`La factura está en ${currencyCode}; falta convertirla a ${ownedCompany.baseCurrencyCode} antes de contabilizar.`);
  }

  const [header] = await input.client
    .insert(supplierInvoice)
    .values({
      companyId: input.companyId,
      supplierPartnerId: input.supplierPartnerId,
      purchaseOrderId: input.purchaseOrderId ?? null,
      goodsReceiptId: input.goodsReceiptId ?? null,
      origin: input.origin,
      number,
      supplierDocumentNumber,
      supplierDocumentNumberNormalized,
      supplierIdentityKey,
      documentSha256: input.documentSha256 ?? null,
      idempotencyKey: input.idempotencyKey?.trim() || null,
      currencyCode,
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
      .for("update")
      .limit(1);
    if (!ownedOrder) throw new Error("Pedido de compra no encontrado.");
    if (ownedOrder.supplierPartnerId !== input.supplierPartnerId) throw new Error("El proveedor no coincide con el pedido de compra.");

    const [ownedReceipt] = await tx
      .select({ id: goodsReceipt.id, purchaseOrderId: goodsReceipt.purchaseOrderId })
      .from(goodsReceipt)
      .where(eq(goodsReceipt.id, input.goodsReceiptId))
      .for("update")
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
      .innerJoin(goodsReceipt, eq(goodsReceipt.id, goodsReceiptLine.goodsReceiptId))
      .where(eq(goodsReceipt.purchaseOrderId, input.purchaseOrderId));
    const alreadyInvoicedLines = await tx
      .select({ itemId: supplierInvoiceLine.itemId, quantity: supplierInvoiceLine.quantity })
      .from(supplierInvoiceLine)
      .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierInvoiceLine.supplierInvoiceId))
      .where(and(
        eq(supplierInvoice.companyId, input.companyId),
        eq(supplierInvoice.purchaseOrderId, input.purchaseOrderId),
        ne(supplierInvoice.status, "VOID"),
      ));
    const poQtyByItem = new Map<string, number>();
    const receiptQtyByItem = new Map<string, number>();
    const invoicedQtyByItem = new Map<string, number>();
    const requestedQtyByItem = new Map<string, number>();
    for (const line of poLines) if (line.itemId) poQtyByItem.set(line.itemId, (poQtyByItem.get(line.itemId) ?? 0) + Number(line.quantity));
    for (const line of receiptLines) if (line.itemId) receiptQtyByItem.set(line.itemId, (receiptQtyByItem.get(line.itemId) ?? 0) + Number(line.quantity));
    for (const line of alreadyInvoicedLines) if (line.itemId) invoicedQtyByItem.set(line.itemId, (invoicedQtyByItem.get(line.itemId) ?? 0) + Number(line.quantity));
    for (const line of input.lines) if (line.itemId) requestedQtyByItem.set(line.itemId, (requestedQtyByItem.get(line.itemId) ?? 0) + line.quantity);

    for (const [itemId, requestedQuantity] of requestedQtyByItem) {
      const cumulativeQuantity = (invoicedQtyByItem.get(itemId) ?? 0) + requestedQuantity;
      if (cumulativeQuantity > (poQtyByItem.get(itemId) ?? 0) + 0.0005) throw new Error("La cantidad facturada acumulada supera la cantidad del pedido.");
      if (cumulativeQuantity > (receiptQtyByItem.get(itemId) ?? 0) + 0.0005) throw new Error("La cantidad facturada acumulada supera la cantidad recepcionada.");
    }

    const created = await createSupplierInvoiceHeader({
      ...input,
      origin: "PURCHASE",
      issueDate: input.issueDate ?? new Date(),
      client: tx,
    });
    const fullyInvoiced = [...poQtyByItem.entries()].every(
      ([itemId, orderedQuantity]) =>
        (invoicedQtyByItem.get(itemId) ?? 0) +
          (requestedQtyByItem.get(itemId) ?? 0) >=
        orderedQuantity - 0.0005,
    );
    if (fullyInvoiced && poQtyByItem.size > 0) {
      await tx
        .update(purchaseOrder)
        .set({ status: "INVOICED" })
        .where(eq(purchaseOrder.id, input.purchaseOrderId));
    }
    return created;
  });
}

export async function createExpenseInvoice(input: CreateExpenseInvoiceInput) {
  return db.transaction(async (tx) => {
    const idempotencyKey = input.idempotencyKey?.trim();
    if (idempotencyKey) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`expense:${input.companyId}:${idempotencyKey}`}))`);
      const [existingByIdempotency] = await tx
        .select()
        .from(supplierInvoice)
        .where(and(eq(supplierInvoice.companyId, input.companyId), eq(supplierInvoice.idempotencyKey, idempotencyKey)))
        .limit(1);
      if (existingByIdempotency) return existingByIdempotency;
    }

    const [ocrJob] = input.ocrJobId
      ? await tx
          .select({
            id: expenseOcrJob.id,
            supplierInvoiceId: expenseOcrJob.supplierInvoiceId,
            fileName: expenseOcrJob.fileName,
            fileUrl: expenseOcrJob.fileUrl,
            storageKey: expenseOcrJob.storageKey,
            contentType: expenseOcrJob.contentType,
            sizeBytes: expenseOcrJob.sizeBytes,
            documentSha256: expenseOcrJob.documentSha256,
          })
          .from(expenseOcrJob)
          .where(and(eq(expenseOcrJob.id, input.ocrJobId), eq(expenseOcrJob.companyId, input.companyId)))
          .for("update")
          .limit(1)
      : [];
    if (input.ocrJobId && !ocrJob) throw new Error("El archivo OCR no pertenece a la empresa activa.");
    if (ocrJob?.supplierInvoiceId) throw new Error("El archivo OCR ya está asociado a otra factura de gasto.");

    const resolvedSupplier = await resolveSupplier({
      companyId: input.companyId,
      supplierPartnerId: input.supplierPartnerId,
      supplierName: input.supplierName,
      supplierTaxId: input.supplierTaxId,
      supplierEmail: input.supplierEmail,
      supplierPhone: input.supplierPhone,
      supplierAddress: input.supplierAddress,
      supplierAddressLine2: input.supplierAddressLine2,
      supplierPostalCode: input.supplierPostalCode,
      supplierCity: input.supplierCity,
      supplierProvince: input.supplierProvince,
      supplierCountryCode: input.supplierCountryCode,
      client: tx,
    });
    await assertNoDuplicateExpenseInvoice({
      companyId: input.companyId,
      supplierDocumentNumber: input.supplierDocumentNumber,
      supplierIdentityKey: resolvedSupplier.identityKey,
      documentSha256: ocrJob?.documentSha256,
      client: tx,
    });
    const ocrAttachment: SupplierInvoiceAttachmentInput[] = ocrJob
      ? [{
          fileName: ocrJob.fileName,
          fileUrl: ocrJob.fileUrl ?? `/api/expenses/ocr/${ocrJob.id}/file`,
          storageKey: ocrJob.storageKey ?? undefined,
          contentType: ocrJob.contentType,
          sizeBytes: ocrJob.sizeBytes ?? undefined,
        }]
      : [];
    const clientAttachments = (input.attachments ?? []).filter((attachment) => !ocrJob || attachment.fileUrl !== ocrJob.fileUrl);
    const created = await createSupplierInvoiceHeader({
      ...input,
      attachments: [...ocrAttachment, ...clientAttachments],
      origin: "EXPENSE",
      supplierPartnerId: resolvedSupplier.id,
      supplierIdentityKey: resolvedSupplier.identityKey,
      documentSha256: ocrJob?.documentSha256,
      idempotencyKey,
      purchaseOrderId: null,
      goodsReceiptId: null,
      client: tx,
    });
    if (ocrJob) {
      await tx
        .update(expenseOcrJob)
        .set({ supplierInvoiceId: created.id })
        .where(and(eq(expenseOcrJob.id, ocrJob.id), eq(expenseOcrJob.companyId, input.companyId)));
      await recordAudit({
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: "expense.ocr.attach",
        entityName: "supplierInvoice",
        entityId: created.id,
        payload: { ocrJobId: ocrJob.id, fileName: ocrJob.fileName },
      }, tx);
    }
    return created;
  });
}

export type ExpenseDuplicateAssessment = {
  level: "none" | "possible" | "exact";
  matches: Array<{ invoiceId: string; number: string; reason: "file" | "supplier-number" | "date-total" }>;
};

export async function assessExpenseDuplicate(input: {
  companyId: string;
  supplierPartnerId?: string;
  supplierTaxId?: string;
  supplierName?: string;
  supplierCountryCode?: string;
  supplierDocumentNumber?: string;
  issueDate?: Date;
  totalAmount?: number;
  documentSha256?: string;
}, client: DbClient = db): Promise<ExpenseDuplicateAssessment> {
  const matches: ExpenseDuplicateAssessment["matches"] = [];
  if (input.documentSha256) {
    const [row] = await client
      .select({ invoiceId: supplierInvoice.id, number: supplierInvoice.number })
      .from(supplierInvoice)
      .where(and(
        eq(supplierInvoice.companyId, input.companyId),
        eq(supplierInvoice.documentSha256, input.documentSha256),
        ne(supplierInvoice.status, "VOID"),
      ))
      .limit(1);
    if (row) matches.push({ ...row, reason: "file" });
  }

  let identityKey: string | null = null;
  if (input.supplierPartnerId) {
    const [supplier] = await client
      .select({ id: partner.id, name: partner.name, taxId: partner.taxId, countryCode: partner.countryCode })
      .from(partner)
      .where(and(eq(partner.companyId, input.companyId), eq(partner.id, input.supplierPartnerId)))
      .limit(1);
    if (supplier) identityKey = buildSupplierIdentityKey({ partnerId: supplier.id, name: supplier.name, taxId: supplier.taxId, countryCode: supplier.countryCode });
  } else if (normalizeTaxIdentity(input.supplierTaxId, input.supplierCountryCode) || input.supplierName?.trim()) {
    identityKey = buildSupplierIdentityKey({
      partnerId: "unmatched",
      name: input.supplierName,
      taxId: input.supplierTaxId,
      countryCode: input.supplierCountryCode,
    });
  }

  const normalizedNumber = normalizeSupplierDocumentNumber(input.supplierDocumentNumber);
  if (identityKey && normalizedNumber) {
    const [row] = await client
      .select({ invoiceId: supplierInvoice.id, number: supplierInvoice.number })
      .from(supplierInvoice)
      .where(and(
        eq(supplierInvoice.companyId, input.companyId),
        eq(supplierInvoice.supplierIdentityKey, identityKey),
        eq(supplierInvoice.supplierDocumentNumberNormalized, normalizedNumber),
        ne(supplierInvoice.status, "VOID"),
      ))
      .limit(1);
    if (row && !matches.some((match) => match.invoiceId === row.invoiceId)) matches.push({ ...row, reason: "supplier-number" });
  }

  if (identityKey && input.issueDate && Number.isFinite(input.totalAmount)) {
    const dayStart = new Date(input.issueDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const [row] = await client
      .select({ invoiceId: supplierInvoice.id, number: supplierInvoice.number })
      .from(supplierInvoice)
      .where(and(
        eq(supplierInvoice.companyId, input.companyId),
        eq(supplierInvoice.supplierIdentityKey, identityKey),
        gte(supplierInvoice.issueDate, dayStart),
        lt(supplierInvoice.issueDate, dayEnd),
        eq(supplierInvoice.totalAmount, Number(input.totalAmount).toFixed(2)),
        ne(supplierInvoice.status, "VOID"),
      ))
      .limit(1);
    if (row && !matches.some((match) => match.invoiceId === row.invoiceId)) matches.push({ ...row, reason: "date-total" });
  }

  const hasExact = matches.some((match) => match.reason === "file" || match.reason === "supplier-number");
  return { level: hasExact ? "exact" : matches.length > 0 ? "possible" : "none", matches };
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
        currencyCode: supplierInvoice.currencyCode,
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
    const paymentStatus = invoice.status === "VOID" ? "VOID" : getPaymentStatus(totalAmount, paidAmount, invoice.dueDate);
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
    .select({ id: partner.id, number: partner.number, name: partner.name, taxId: partner.taxId })
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
      origin: supplierInvoice.origin,
      purchaseOrderId: supplierInvoice.purchaseOrderId,
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
      currencyCode: supplierInvoice.currencyCode,
      notes: supplierInvoice.notes,
      createdAt: supplierInvoice.createdAt,
      updatedAt: supplierInvoice.updatedAt,
    })
    .from(supplierInvoice)
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(eq(supplierInvoice.companyId, companyId), eq(supplierInvoice.id, id)))
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
      .select({ id: supplierPayment.id, number: supplierPayment.number, amountApplied: supplierInvoicePayment.amountApplied, postedAt: supplierPayment.postedAt })
      .from(supplierInvoicePayment)
      .innerJoin(supplierPayment, eq(supplierPayment.id, supplierInvoicePayment.supplierPaymentId))
      .where(and(eq(supplierInvoicePayment.companyId, companyId), eq(supplierInvoicePayment.supplierInvoiceId, id))),
  ]);
  const paidAmount = payments.reduce((total, payment) => total + Number(payment.amountApplied), 0);
  return {
    ...invoiceRow,
    paidAmount: paidAmount.toFixed(2),
    outstandingAmount: Math.max(Number(invoiceRow.totalAmount) - paidAmount, 0).toFixed(2),
    paymentStatus: invoiceRow.status === "VOID" ? "VOID" : getPaymentStatus(Number(invoiceRow.totalAmount), paidAmount, invoiceRow.dueDate),
    lines,
    attachments,
    payments,
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

    const reversedAt = new Date();
    await assertFiscalPeriodOpen(input.companyId, reversedAt, tx);
    await reverseAutomaticEntries({
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      postedAt: reversedAt,
      reference: `Anulacion factura gasto ${invoiceRow.number}`,
      sourceType: "supplierInvoice",
      sourceId: input.id,
      reason: input.reason?.trim() || `Anulación de factura de gasto ${invoiceRow.number}`,
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
