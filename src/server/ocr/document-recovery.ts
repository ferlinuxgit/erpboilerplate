import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, asc, eq, isNotNull } from "drizzle-orm";

import { expenseOcrJob, partner, supplierInvoice, supplierInvoiceAttachment } from "@/db/schema";
import { db } from "@/lib/db";
import { ATTACHMENT_ONLY_PROVIDER, createExpenseOcrJob, sanitizeFileName } from "@/server/ocr/expense-ocr";
import { isObjectStorageConfigured, putPrivateObject } from "@/server/storage/s3";

/**
 * Recuperación de documentos de facturas registradas cuyo archivo se ha perdido (p. ej. guardados
 * en el disco de un contenedor que se redesplegó sin volumen persistente). La factura y su
 * registro de documento siguen en la base de datos: basta con volver a escribir el archivo en su
 * sitio para que la ficha, la exportación y el ZIP para el asesor vuelvan a enlazarlo.
 */

type StoredDocument = Pick<typeof expenseOcrJob.$inferSelect, "filePath" | "storageKey">;

/** El archivo existe donde dice el registro (en S3 se da por disponible). */
export async function isDocumentAvailable(job: StoredDocument) {
  if (job.storageKey?.startsWith("s3:")) return true;
  try {
    await access(/* turbopackIgnore: true */ job.filePath);
    return true;
  } catch {
    return false;
  }
}

export type MissingInvoiceDocument = {
  jobId: string;
  supplierInvoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  supplierDocumentNumber: string | null;
  issueDate: Date;
  totalAmount: number;
  fileName: string;
};

/** Documentos de facturas registradas cuyo archivo ya no está disponible. */
export async function listMissingInvoiceDocuments(companyId: string, supplierInvoiceId?: string): Promise<MissingInvoiceDocument[]> {
  const rows = await db
    .select({
      jobId: expenseOcrJob.id,
      filePath: expenseOcrJob.filePath,
      storageKey: expenseOcrJob.storageKey,
      fileName: expenseOcrJob.fileName,
      supplierInvoiceId: supplierInvoice.id,
      invoiceNumber: supplierInvoice.number,
      supplierName: partner.name,
      supplierDocumentNumber: supplierInvoice.supplierDocumentNumber,
      issueDate: supplierInvoice.issueDate,
      totalAmount: supplierInvoice.totalAmount,
    })
    .from(expenseOcrJob)
    .innerJoin(supplierInvoice, eq(supplierInvoice.id, expenseOcrJob.supplierInvoiceId))
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(
      eq(expenseOcrJob.companyId, companyId),
      isNotNull(expenseOcrJob.supplierInvoiceId),
      supplierInvoiceId ? eq(expenseOcrJob.supplierInvoiceId, supplierInvoiceId) : undefined,
    ))
    .orderBy(asc(supplierInvoice.issueDate), asc(supplierInvoice.number));
  const missing: MissingInvoiceDocument[] = [];
  for (const row of rows) {
    if (await isDocumentAvailable(row)) continue;
    missing.push({
      jobId: row.jobId,
      supplierInvoiceId: row.supplierInvoiceId,
      invoiceNumber: row.invoiceNumber,
      supplierName: row.supplierName,
      supplierDocumentNumber: row.supplierDocumentNumber,
      issueDate: row.issueDate,
      totalAmount: Number(row.totalAmount),
      fileName: row.fileName,
    });
  }
  return missing;
}

/** Vuelve a escribir el archivo de un registro de documento (en S3 si está configurado). */
async function writeDocument(job: typeof expenseOcrJob.$inferSelect, contentType: string, buffer: Buffer) {
  const objectKey = job.storageKey?.replace(/^(?:local|s3):/, "") || `${job.tenantId}/${job.companyId}/expense-ocr/${job.id}-${sanitizeFileName(job.fileName)}`;
  if (isObjectStorageConfigured()) {
    await putPrivateObject(objectKey, contentType, buffer);
    return { storageKey: `s3:${objectKey}` };
  }
  await mkdir(path.dirname(job.filePath), { recursive: true });
  await writeFile(/* turbopackIgnore: true */ job.filePath, buffer);
  return { storageKey: `local:${objectKey}` };
}

const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

export type RestoreByHashResult =
  | { status: "restored"; invoices: Array<{ id: string; number: string; supplierName: string }> }
  | { status: "already-available"; invoices: Array<{ id: string; number: string; supplierName: string }> }
  | { status: "unmatched" };

/**
 * Restaura un documento perdido identificándolo por su huella SHA-256: solo el mismo archivo que
 * se subió en su día coincide, así que nunca se adjunta a la factura equivocada.
 */
export async function restoreDocumentByHash(companyId: string, buffer: Buffer, contentType: string): Promise<RestoreByHashResult> {
  const jobs = await db
    .select({ job: expenseOcrJob, invoiceNumber: supplierInvoice.number, supplierName: partner.name })
    .from(expenseOcrJob)
    .innerJoin(supplierInvoice, eq(supplierInvoice.id, expenseOcrJob.supplierInvoiceId))
    .innerJoin(partner, eq(partner.id, supplierInvoice.supplierPartnerId))
    .where(and(eq(expenseOcrJob.companyId, companyId), eq(expenseOcrJob.documentSha256, sha256(buffer))));
  if (jobs.length === 0) return { status: "unmatched" };
  const restored: Array<{ id: string; number: string; supplierName: string }> = [];
  const available: Array<{ id: string; number: string; supplierName: string }> = [];
  for (const { job, invoiceNumber, supplierName } of jobs) {
    const invoice = { id: job.supplierInvoiceId!, number: invoiceNumber, supplierName };
    if (await isDocumentAvailable(job)) {
      available.push(invoice);
      continue;
    }
    const { storageKey } = await writeDocument(job, job.contentType || contentType, buffer);
    if (storageKey !== job.storageKey) await db.update(expenseOcrJob).set({ storageKey }).where(eq(expenseOcrJob.id, job.id));
    restored.push(invoice);
  }
  return restored.length > 0 ? { status: "restored", invoices: restored } : { status: "already-available", invoices: available };
}

/**
 * Adjunta un documento a una factura registrada desde su ficha. Si la factura tenía un documento
 * perdido, el archivo ocupa su lugar (mismos enlaces); si no, se añade como adjunto nuevo.
 */
export async function attachDocumentToSupplierInvoice(input: {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  supplierInvoiceId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}) {
  const [invoice] = await db
    .select({ id: supplierInvoice.id })
    .from(supplierInvoice)
    .where(and(eq(supplierInvoice.companyId, input.companyId), eq(supplierInvoice.id, input.supplierInvoiceId)))
    .limit(1);
  if (!invoice) return null;

  const [missing] = await listMissingInvoiceDocuments(input.companyId, invoice.id);
  if (missing) {
    const [job] = await db.select().from(expenseOcrJob).where(eq(expenseOcrJob.id, missing.jobId)).limit(1);
    const { storageKey } = await writeDocument(job, input.contentType, input.buffer);
    // Puede no ser el archivo original byte a byte (otra descarga): la huella pasa a ser la del nuevo.
    await db
      .update(expenseOcrJob)
      .set({ storageKey, contentType: input.contentType, sizeBytes: input.buffer.byteLength, documentSha256: sha256(input.buffer) })
      .where(eq(expenseOcrJob.id, job.id));
    await db
      .update(supplierInvoiceAttachment)
      .set({ contentType: input.contentType, sizeBytes: input.buffer.byteLength })
      .where(and(eq(supplierInvoiceAttachment.supplierInvoiceId, invoice.id), eq(supplierInvoiceAttachment.fileUrl, job.fileUrl ?? `/api/expenses/ocr/${job.id}/file`)));
    return { mode: "restored" as const, jobId: job.id };
  }

  const job = await createExpenseOcrJob({
    tenantId: input.tenantId,
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    fileName: input.fileName,
    contentType: input.contentType,
    buffer: input.buffer,
    initialStatus: "DONE",
    extractionProvider: ATTACHMENT_ONLY_PROVIDER,
  });
  await db.update(expenseOcrJob).set({ supplierInvoiceId: invoice.id }).where(eq(expenseOcrJob.id, job.id));
  await db.insert(supplierInvoiceAttachment).values({
    supplierInvoiceId: invoice.id,
    companyId: input.companyId,
    fileName: job.fileName,
    fileUrl: job.fileUrl ?? `/api/expenses/ocr/${job.id}/file`,
    storageKey: job.storageKey,
    contentType: job.contentType,
    sizeBytes: job.sizeBytes,
  });
  return { mode: "added" as const, jobId: job.id };
}

/** Registros de documento de una factura cuyo archivo no está disponible (para avisar en la ficha). */
export async function missingDocumentJobIds(companyId: string, supplierInvoiceId: string) {
  return new Set((await listMissingInvoiceDocuments(companyId, supplierInvoiceId)).map((document) => document.jobId));
}

