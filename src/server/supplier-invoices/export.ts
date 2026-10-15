import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { accountChart, company, expenseOcrJob, partner, purchaseOrder, supplierInvoice, supplierInvoiceLine } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { recordAudit } from "@/server/audit";
import { listWhere } from "@/server/lists/paginate";
import { readExpenseOcrFile } from "@/server/ocr/expense-ocr";
import { buildExpenseExport, type ExpenseExportInvoice } from "@/server/supplier-invoices/export-model";
import { expenseExpressions, paidByInvoice } from "@/server/supplier-invoices/list";

/** Límites de una exportación (se genera en memoria). */
export const EXPENSE_EXPORT_MAX_INVOICES = 3_000;
export const EXPENSE_EXPORT_MAX_DOCUMENT_BYTES = 400 * 1024 * 1024;

export type ExpenseExportFilters = {
  from: string | null;
  to: string | null;
  q: string;
  status: string | null;
};

function formatDay(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function expenseExportPeriodLabel(filters: Pick<ExpenseExportFilters, "from" | "to">) {
  if (filters.from && filters.to) return `Del ${formatDay(filters.from)} al ${formatDay(filters.to)}`;
  if (filters.from) return `Desde el ${formatDay(filters.from)}`;
  if (filters.to) return `Hasta el ${formatDay(filters.to)}`;
  return "Todas las fechas";
}

/**
 * Facturas de proveedor del filtro (mismos criterios que el listado de /expenses), sin anuladas,
 * ordenadas por fecha y número de registro, en Excel o en ZIP con sus documentos.
 */
export async function generateExpenseExport(input: {
  companyId: string;
  tenantId: string;
  actorUserId: string;
  filters: ExpenseExportFilters;
  includeDocuments: boolean;
}) {
  const paid = paidByInvoice(input.companyId);
  const { paidAmount, paymentStatus } = expenseExpressions(paid, new Date());
  const where = listWhere({
    base: [eq(supplierInvoice.companyId, input.companyId), ne(supplierInvoice.status, "VOID")],
    search: { q: input.filters.q, columns: [supplierInvoice.number, supplierInvoice.supplierDocumentNumber, partner.name, purchaseOrder.number] },
    dateRange: { column: supplierInvoice.issueDate, from: input.filters.from, to: input.filters.to },
    filters: [input.filters.status ? sql`${paymentStatus} = ${input.filters.status}` : undefined],
  });

  const [[companyRow], headers] = await Promise.all([
    db.select({ name: company.name, vatNumber: company.vatNumber }).from(company).where(eq(company.id, input.companyId)).limit(1),
    db
      .select({
        id: supplierInvoice.id,
        number: supplierInvoice.number,
        issueDate: supplierInvoice.issueDate,
        accountingDate: supplierInvoice.accountingDate,
        prorrataPct: supplierInvoice.prorrataPct,
        dueDate: supplierInvoice.dueDate,
        supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
        supplierName: partner.name,
        supplierTaxId: partner.taxId,
        supplierCountryCode: partner.countryCode,
        vatTreatment: supplierInvoice.vatTreatment,
        currencyCode: supplierInvoice.currencyCode,
        subtotalAmount: supplierInvoice.subtotalAmount,
        taxAmount: supplierInvoice.taxAmount,
        retentionAmount: supplierInvoice.retentionAmount,
        totalAmount: supplierInvoice.totalAmount,
        notes: supplierInvoice.notes,
        purchaseOrderNumber: purchaseOrder.number,
        paidAmount: paidAmount.mapWith(Number),
        paymentStatus,
      })
      .from(supplierInvoice)
      .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
      .leftJoin(purchaseOrder, eq(purchaseOrder.id, supplierInvoice.purchaseOrderId))
      .leftJoin(paid, eq(paid.supplierInvoiceId, supplierInvoice.id))
      .where(where)
      .orderBy(asc(supplierInvoice.issueDate), asc(supplierInvoice.number))
      .limit(EXPENSE_EXPORT_MAX_INVOICES + 1),
  ]);
  if (headers.length > EXPENSE_EXPORT_MAX_INVOICES) {
    throw new HttpError(422, `Hay más de ${EXPENSE_EXPORT_MAX_INVOICES} facturas en el filtro. Exporta un periodo más corto (por ejemplo, un trimestre).`);
  }

  const ids = headers.map((row) => row.id);
  const [lines, documents] = ids.length === 0
    ? [[], []]
    : await Promise.all([
      db
        .select({
          supplierInvoiceId: supplierInvoiceLine.supplierInvoiceId,
          accountCode: accountChart.code,
          accountName: accountChart.name,
          base: supplierInvoiceLine.subtotalAmount,
          taxRate: supplierInvoiceLine.taxRate,
          taxAmount: supplierInvoiceLine.taxAmount,
          taxDeductiblePct: supplierInvoiceLine.taxDeductiblePct,
          retentionRate: supplierInvoiceLine.retentionRate,
          retentionAmount: supplierInvoiceLine.retentionAmount,
        })
        .from(supplierInvoiceLine)
        .leftJoin(accountChart, eq(accountChart.id, supplierInvoiceLine.expenseAccountId))
        .where(inArray(supplierInvoiceLine.supplierInvoiceId, ids)),
      // El original de cada factura (subido por OCR o adjuntado a mano) se guarda como trabajo de OCR vinculado.
      db
        .select({
          supplierInvoiceId: expenseOcrJob.supplierInvoiceId,
          fileName: expenseOcrJob.fileName,
          contentType: expenseOcrJob.contentType,
          sizeBytes: expenseOcrJob.sizeBytes,
          filePath: expenseOcrJob.filePath,
          storageKey: expenseOcrJob.storageKey,
        })
        .from(expenseOcrJob)
        .where(and(eq(expenseOcrJob.companyId, input.companyId), inArray(expenseOcrJob.supplierInvoiceId, ids)))
        .orderBy(asc(expenseOcrJob.createdAt)),
    ]);

  if (input.includeDocuments) {
    const totalBytes = documents.reduce((total, document) => total + (document.sizeBytes ?? 0), 0);
    if (totalBytes > EXPENSE_EXPORT_MAX_DOCUMENT_BYTES) {
      throw new HttpError(422, `Los documentos del filtro ocupan ${Math.round(totalBytes / 1024 / 1024)} MB. Exporta un periodo más corto (máximo ${EXPENSE_EXPORT_MAX_DOCUMENT_BYTES / 1024 / 1024} MB por ZIP).`);
    }
  }

  const invoices: ExpenseExportInvoice[] = headers.map((row) => ({
    id: row.id,
    number: row.number,
    issueDate: row.issueDate,
    accountingDate: row.accountingDate,
    dueDate: row.dueDate,
    supplierDocumentNumber: row.supplierDocumentNumber,
    supplierName: row.supplierName,
    supplierTaxId: row.supplierTaxId,
    supplierCountryCode: row.supplierCountryCode,
    vatTreatment: row.vatTreatment,
    currencyCode: row.currencyCode,
    subtotalAmount: Number(row.subtotalAmount),
    taxAmount: Number(row.taxAmount),
    retentionAmount: Number(row.retentionAmount),
    totalAmount: Number(row.totalAmount),
    paidAmount: row.paidAmount,
    paymentStatus: row.paymentStatus,
    purchaseOrderNumber: row.purchaseOrderNumber,
    notes: row.notes,
    // Prorrata guardada al contabilizar la factura.
    prorrataPct: Number(row.prorrataPct),
    lines: lines
      .filter((line) => line.supplierInvoiceId === row.id)
      .map((line) => ({
        accountCode: line.accountCode,
        accountName: line.accountName,
        base: Number(line.base),
        taxRate: Number(line.taxRate),
        taxAmount: Number(line.taxAmount),
        taxDeductiblePct: Number(line.taxDeductiblePct),
        retentionRate: Number(line.retentionRate),
        retentionAmount: Number(line.retentionAmount),
      })),
    documents: documents
      .filter((document) => document.supplierInvoiceId === row.id)
      .map((document) => ({
        fileName: document.fileName,
        contentType: document.contentType,
        load: async () => new Uint8Array(await readExpenseOcrFile(document)),
      })),
  }));

  const generatedAt = new Date();
  const periodLabel = expenseExportPeriodLabel(input.filters);
  const result = await buildExpenseExport(
    { companyName: companyRow?.name ?? "Empresa", companyTaxId: companyRow?.vatNumber ?? null, periodLabel, generatedAt, invoices },
    { includeDocuments: input.includeDocuments },
  );

  await recordAudit({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    action: "expense.export",
    entityName: "supplierInvoice",
    entityId: input.companyId,
    payload: { filters: input.filters, includeDocuments: input.includeDocuments, invoices: invoices.length, missingDocuments: result.missing.length },
  });
  return result;
}
