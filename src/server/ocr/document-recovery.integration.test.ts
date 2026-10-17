import { rmSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Recuperación de documentos perdidos contra Postgres real (PGlite) y un disco temporal. */

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
}));

// El almacén local se fija al cargar el módulo: el directorio temporal va antes de importarlo.
const uploadDir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync: mkdtemp } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const dir = mkdtemp(join(tmpdir(), "doc-recovery-"));
  process.env.LOCAL_UPLOAD_DIR = dir;
  return dir;
});

vi.mock("@/lib/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  state.client = new PGlite();
  state.db = drizzle(state.client, { schema });
  return { db: state.db };
});

vi.mock("@/server/storage/s3", () => ({
  isObjectStorageConfigured: () => false,
  putPrivateObject: vi.fn(),
  readPrivateObject: vi.fn(),
  deletePrivateObject: vi.fn(),
}));

import * as schema from "@/db/schema";
import { company, expenseOcrJob, partner, supplierInvoice, supplierInvoiceAttachment, tenant, user } from "@/db/schema";
import { attachDocumentToSupplierInvoice, listMissingInvoiceDocuments, restoreDocumentByHash } from "@/server/ocr/document-recovery";
import { createExpenseOcrJob, readExpenseOcrFile } from "@/server/ocr/expense-ocr";

const original = Buffer.from("%PDF-1.4 factura Anthropic original");
const otherPdf = Buffer.from("%PDF-1.4 otra factura distinta");

async function invoiceWithDocument(number: string, buffer: Buffer) {
  const [invoice] = await state.db.insert(supplierInvoice).values({ companyId: "company-1", supplierPartnerId: "partner-1", number, totalAmount: "93.33" }).returning();
  const job = await createExpenseOcrJob({ tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1", fileName: `${number}.pdf`, contentType: "application/pdf", buffer, initialStatus: "DONE" });
  await state.db.update(expenseOcrJob).set({ supplierInvoiceId: invoice.id }).where(eq(expenseOcrJob.id, job.id));
  await state.db.insert(supplierInvoiceAttachment).values({ supplierInvoiceId: invoice.id, companyId: "company-1", fileName: job.fileName, fileUrl: job.fileUrl, contentType: "application/pdf", sizeBytes: buffer.byteLength });
  return { invoice, job };
}

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as unknown as Record<string, unknown>));
  for (const statement of statements) await state.client.exec(statement);
  await state.db.insert(user).values({ id: "user-1", name: "Ana", email: "ana@example.com" });
  await state.db.insert(tenant).values({ id: "tenant-1", name: "T", slug: "t", ownerId: "user-1" });
  await state.db.insert(company).values({ id: "company-1", tenantId: "tenant-1", name: "Empresa" });
  await state.db.insert(partner).values({ id: "partner-1", companyId: "company-1", number: "P-1", name: "Anthropic Ireland, Limited", type: "SUPPLIER" });
}, 60_000);

afterAll(async () => {
  await state.client?.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("recuperación de documentos perdidos", () => {
  it("detecta el documento perdido y lo repone solo con el mismo archivo (huella), en su sitio", async () => {
    const { invoice, job } = await invoiceWithDocument("BILL-1", original);
    expect(await listMissingInvoiceDocuments("company-1")).toEqual([]);

    // Un despliegue sin volumen borra el disco.
    await rm(job.filePath, { force: true });
    expect((await listMissingInvoiceDocuments("company-1")).map((document) => document.invoiceNumber)).toEqual(["BILL-1"]);

    expect(await restoreDocumentByHash("company-1", otherPdf, "application/pdf")).toEqual({ status: "unmatched" });
    expect(await restoreDocumentByHash("company-1", original, "application/pdf")).toEqual({
      status: "restored",
      invoices: [{ id: invoice.id, number: "BILL-1", supplierName: "Anthropic Ireland, Limited" }],
    });
    expect(await readExpenseOcrFile(job)).toEqual(original);
    expect(await listMissingInvoiceDocuments("company-1")).toEqual([]);
    // Volver a soltarlo no hace nada.
    expect((await restoreDocumentByHash("company-1", original, "application/pdf")).status).toBe("already-available");
  });

  it("desde la ficha repone el documento perdido aunque no sea idéntico, sin crear otro adjunto", async () => {
    const { invoice, job } = await invoiceWithDocument("BILL-2", Buffer.from("%PDF-1.4 descarga antigua"));
    await rm(job.filePath, { force: true });
    const redownload = Buffer.from("%PDF-1.4 nueva descarga del proveedor");

    const result = await attachDocumentToSupplierInvoice({ tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1", supplierInvoiceId: invoice.id, fileName: "nueva.pdf", contentType: "application/pdf", buffer: redownload });
    expect(result).toEqual({ mode: "restored", jobId: job.id });
    expect(await readFile(job.filePath)).toEqual(redownload);
    const attachments = await state.db.select().from(supplierInvoiceAttachment).where(eq(supplierInvoiceAttachment.supplierInvoiceId, invoice.id));
    expect(attachments).toHaveLength(1);
    expect(attachments[0].sizeBytes).toBe(redownload.byteLength);
  });

  it("desde la ficha añade un adjunto nuevo cuando no falta ninguno", async () => {
    const { invoice } = await invoiceWithDocument("BILL-3", Buffer.from("%PDF-1.4 tercera"));
    const result = await attachDocumentToSupplierInvoice({ tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1", supplierInvoiceId: invoice.id, fileName: "albaran.pdf", contentType: "application/pdf", buffer: Buffer.from("%PDF-1.4 albarán") });
    expect(result?.mode).toBe("added");
    const attachments = await state.db.select().from(supplierInvoiceAttachment).where(eq(supplierInvoiceAttachment.supplierInvoiceId, invoice.id));
    expect(attachments.map((attachment: { fileName: string }) => attachment.fileName)).toEqual(["BILL-3.pdf", "albaran.pdf"]);
    const jobs = await state.db.select().from(expenseOcrJob).where(eq(expenseOcrJob.supplierInvoiceId, invoice.id));
    expect(jobs).toHaveLength(2);
    expect(await attachDocumentToSupplierInvoice({ tenantId: "tenant-1", companyId: "company-1", actorUserId: "user-1", supplierInvoiceId: "no-existe", fileName: "x.pdf", contentType: "application/pdf", buffer: original })).toBeNull();
  });
});
