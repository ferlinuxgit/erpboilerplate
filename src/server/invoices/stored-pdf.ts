import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { company, invoice } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { invoiceLifecycle } from "@/server/invoices/lifecycle";
import { readPrivateFile, storePrivateFile } from "@/server/storage/files";

/**
 * PDF conservado de las facturas emitidas. Al emitir se genera y se guarda con su número
 * definitivo; desde entonces la ficha, el email y las exportaciones usan esa copia, no un PDF
 * recalculado (que cambiaría si cambian el logo, los datos de la empresa o la plantilla).
 * Los borradores siempre se generan al vuelo.
 */

type StoredPdf = { bytes: Buffer; fileName: string; stored: boolean };

async function loadInvoiceRow(companyId: string, invoiceId: string) {
  const [row] = await db
    .select({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      pdfStorageKey: invoice.pdfStorageKey,
      pdfFileName: invoice.pdfFileName,
    })
    .from(invoice)
    .where(and(eq(invoice.companyId, companyId), eq(invoice.id, invoiceId)))
    .limit(1);
  return row ?? null;
}

async function renderPdf(companyId: string, invoiceId: string) {
  // Import diferido: el renderizador es pesado y getInvoicePdfData depende del servicio de facturas.
  const [{ getInvoicePdfData }, { renderInvoicePdf }] = await Promise.all([import("@/server/pdf/invoice-pdf"), import("@/server/pdf/render")]);
  const data = await getInvoicePdfData(companyId, invoiceId);
  if (!data) return null;
  return { bytes: Buffer.from(await renderInvoicePdf(data.input)), fileName: data.filename };
}

async function tenantIdFor(companyId: string) {
  const [row] = await db.select({ tenantId: company.tenantId }).from(company).where(eq(company.id, companyId)).limit(1);
  return row?.tenantId ?? "tenant";
}

/** Genera y guarda (o sustituye) el PDF de una factura emitida. No hace nada con borradores. */
export async function storeInvoicePdf(companyId: string, invoiceId: string): Promise<StoredPdf | null> {
  const row = await loadInvoiceRow(companyId, invoiceId);
  if (!row || invoiceLifecycle(row) === "DRAFT") return null;
  const rendered = await renderPdf(companyId, invoiceId);
  if (!rendered) return null;
  const storageKey = await storePrivateFile({
    tenantId: await tenantIdFor(companyId),
    companyId,
    folder: "invoice-pdf",
    fileName: `${invoiceId}.pdf`,
    contentType: "application/pdf",
    body: rendered.bytes,
  });
  await db
    .update(invoice)
    .set({
      pdfStorageKey: storageKey,
      pdfFileName: rendered.fileName,
      pdfSha256: createHash("sha256").update(rendered.bytes).digest("hex"),
      pdfGeneratedAt: new Date(),
    })
    .where(and(eq(invoice.companyId, companyId), eq(invoice.id, invoiceId)));
  return { ...rendered, stored: true };
}

/**
 * Guarda el PDF tras emitir o editar una factura emitida sin hacer fallar la operación: si no se
 * puede (almacenamiento caído…), se registra y se generará la próxima vez que se pida.
 */
export async function storeInvoicePdfQuietly(companyId: string, invoiceId: string) {
  try {
    await storeInvoicePdf(companyId, invoiceId);
  } catch (error) {
    logger.error({ invoiceId, error: error instanceof Error ? error.message : String(error) }, "invoice.pdf_store_failed");
  }
}

/**
 * PDF para ver, enviar o exportar: la copia guardada si existe; si no (emitidas antes de guardar
 * PDF, o fallo al guardar) se genera y se guarda; los borradores se generan sin guardar.
 */
export async function getInvoicePdf(companyId: string, invoiceId: string): Promise<StoredPdf | null> {
  const row = await loadInvoiceRow(companyId, invoiceId);
  if (!row) return null;
  if (invoiceLifecycle(row) === "DRAFT") {
    const rendered = await renderPdf(companyId, invoiceId);
    return rendered ? { ...rendered, stored: false } : null;
  }
  if (row.pdfStorageKey) {
    try {
      return { bytes: await readPrivateFile(row.pdfStorageKey), fileName: row.pdfFileName ?? `${row.number}.pdf`, stored: true };
    } catch (error) {
      logger.error({ invoiceId, error: error instanceof Error ? error.message : String(error) }, "invoice.pdf_read_failed");
    }
  }
  return storeInvoicePdf(companyId, invoiceId);
}
