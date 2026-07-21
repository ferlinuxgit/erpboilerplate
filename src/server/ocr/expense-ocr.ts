import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { expenseIngestionBatch, expenseOcrJob } from "@/db/schema";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isValidSpanishTaxId, normalizeSpanishTaxId } from "@/lib/spanish-tax-id";
import { deletePrivateObject, isObjectStorageConfigured, putPrivateObject, readPrivateObject } from "@/server/storage/s3";

export type ExpenseOcrStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

export type ExpenseOcrDraftLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxDeductiblePct: number;
  retentionRate: number;
  suggestedExpenseAccountCode?: string;
};

export type ExpenseOcrDraft = {
  supplierName?: string;
  supplierTaxId?: string;
  supplierEmail?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  supplierPostalCode?: string;
  supplierCity?: string;
  supplierProvince?: string;
  supplierCountryCode?: string;
  supplierDocumentNumber?: string;
  currencyCode?: string;
  issueDate?: string;
  dueDate?: string;
  subtotalAmount?: number;
  taxAmount?: number;
  retentionAmount?: number;
  totalAmount?: number;
  lines: ExpenseOcrDraftLine[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

const uploadRoot = process.env.LOCAL_UPLOAD_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "uploads");
const tessdataPath = process.env.TESSDATA_PREFIX || path.join(/* turbopackIgnore: true */ process.cwd(), "public", "ocr", "lang");
const tesseractCachePath = process.env.TESSERACT_CACHE_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "tesseract-cache");
const supportedContentTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const maxPdfPages = Number(process.env.OCR_MAX_PDF_PAGES ?? 20);
const maxRenderedPixels = Number(process.env.OCR_MAX_RENDERED_PIXELS ?? 24_000_000);
const jobLeaseMs = Number(process.env.OCR_JOB_LEASE_MS ?? 10 * 60 * 1000);
const maxJobAttempts = Number(process.env.OCR_MAX_JOB_ATTEMPTS ?? 5);
const execFileAsync = promisify(execFile);

function persistedSourceText(value: string | undefined) {
  return process.env.OCR_STORE_SOURCE_TEXT === "true" ? value?.slice(0, 250_000) ?? null : null;
}

const importRuntimeModule = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;

function sanitizeFileName(fileName: string) {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "expense-document";
}

function normalizeMoney(value: string | null | undefined) {
  if (!value) return undefined;
  const normalized = value
    .replace(/\s/g, "")
    .replace(/[€$]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : undefined;
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return undefined;
  const match = /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(value);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  if (!day || !month || !year) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

function assertFileSignature(contentType: string, buffer: Buffer) {
  const isPdf = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  const valid = contentType === "application/pdf" ? isPdf
    : contentType === "image/png" ? isPng
      : contentType === "image/jpeg" ? isJpeg
        : contentType === "image/webp" ? isWebp
          : false;
  if (!valid) throw new Error("El contenido del archivo no coincide con su formato declarado.");
}

async function scanUploadedFile(filePath: string) {
  if (process.env.OCR_CLAMAV_ENABLED !== "true") return;
  try {
    await execFileAsync("clamdscan", ["--fdpass", "--no-summary", filePath], { timeout: 60_000 });
  } catch (error) {
    const output = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
    if (output.includes("FOUND")) throw new Error("El archivo fue rechazado por el análisis antivirus.");
    throw new Error("No se pudo completar el análisis antivirus del archivo.");
  }
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function inferSupplierName(lines: string[]) {
  const ignored = /factura|invoice|ticket|recibo|fecha|nif|cif|total|base|iva/i;
  return lines.find((line) => line.length >= 3 && line.length <= 80 && !ignored.test(line));
}

function findTaxId(text: string) {
  const labeled = firstMatch(text, [
    /(?:cif|nif|nie|vat|tax id|n\.i\.f\.|nif\/cif)\s*:?\s*([A-Z0-9\s.-]{8,16})/i,
  ]);
  const normalizedLabeled = normalizeSpanishTaxId(labeled);
  if (isValidSpanishTaxId(normalizedLabeled)) return normalizedLabeled;

  const matches = text.match(/[A-Z]\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*[0-9A-Z]|\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*\d\s*[-.]?\s*[A-Z]/gi) ?? [];
  return matches.map(normalizeSpanishTaxId).find(isValidSpanishTaxId);
}

function findEmail(text: string) {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function findPhone(text: string) {
  return firstMatch(text, [
    /(?:tel[eé]fono|tel\.?|phone)\s*:?\s*([+()0-9\s.-]{9,})/i,
  ]);
}

export function parseExpenseOcrText(text: string): ExpenseOcrDraft {
  const cleanText = text.replace(/\u00a0/g, " ");
  const lines = cleanText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const supplierName = firstMatch(cleanText, [
    /(?:proveedor|emisor|supplier|vendor)\s*:?\s*([^\n]+)/i,
    /(?:raz[oó]n social)\s*:?\s*([^\n]+)/i,
  ]) ?? inferSupplierName(lines);
  const supplierTaxId = findTaxId(cleanText);
  const supplierEmail = findEmail(cleanText);
  const supplierPhone = findPhone(cleanText);
  const supplierAddress = firstMatch(cleanText, [/(?:direcci[oó]n|domicilio|address)\s*:?\s*([^\n]+)/i]);
  const supplierPostalCode = firstMatch(cleanText, [/\b(0[1-9]\d{3}|[1-4]\d{4}|5[0-2]\d{3})\b/]);
  const supplierCity = firstMatch(cleanText, [/(?:poblaci[oó]n|ciudad|city)\s*:?\s*([^\n]+)/i]);
  const supplierProvince = firstMatch(cleanText, [/(?:provincia|province)\s*:?\s*([^\n]+)/i]);
  const supplierDocumentNumber = firstMatch(cleanText, [
    /(?:factura|invoice|n[úu]mero|num\.?|nº)\s*(?:n[úu]mero|num\.?|nº|#)?\s*:?\s*([A-Z0-9./_-]{3,})/i,
  ]);
  const issueDate = normalizeDate(firstMatch(cleanText, [
    /(?:fecha factura|fecha de factura|fecha emisi[oó]n|issue date|date)\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
  ]));
  const dueDate = normalizeDate(firstMatch(cleanText, [
    /(?:vencimiento|fecha vencimiento|due date)\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
  ]));
  const subtotalAmount = normalizeMoney(firstMatch(cleanText, [
    /(?:base imponible|subtotal|base)\s*:?\s*([-+]?\d[\d.,]*)/i,
  ]));
  const taxAmount = normalizeMoney(firstMatch(cleanText, [
    /(?:iva|vat)(?:\s+\d{1,2}(?:[,.]\d+)?\s*%)?\s*:?\s*([-+]?\d[\d.,]*)/i,
  ]));
  const retentionAmount = normalizeMoney(firstMatch(cleanText, [
    /(?:retenci[oó]n|irpf|withholding)(?:\s+\d{1,2}(?:[,.]\d+)?\s*%)?\s*:?\s*([-+]?\d[\d.,]*)/i,
  ])) ?? 0;
  const totalAmount = normalizeMoney(firstMatch(cleanText, [
    /(?:total factura|importe total|total a pagar|total)\s*:?\s*([-+]?\d[\d.,]*)/i,
  ]));
  const taxRate = Number(firstMatch(cleanText, [/(?:iva|vat)\s*(\d{1,2}(?:[,.]\d+)?)\s*%/i])?.replace(",", ".") ?? 21);
  const retentionRate = Number(firstMatch(cleanText, [/(?:retenci[oó]n|irpf)\s*(\d{1,2}(?:[,.]\d+)?)\s*%/i])?.replace(",", ".") ?? 0);
  const computedSubtotal = subtotalAmount ?? (totalAmount !== undefined && taxAmount !== undefined ? totalAmount - taxAmount + retentionAmount : undefined);
  const warnings: string[] = [];
  if (totalAmount !== undefined && computedSubtotal !== undefined && taxAmount !== undefined) {
    const expected = Math.round((computedSubtotal + taxAmount - retentionAmount + Number.EPSILON) * 100) / 100;
    if (Math.abs(expected - totalAmount) > 0.03) warnings.push("Los totales OCR no cuadran exactamente; revisa base, IVA y retencion.");
  }
  if (!supplierName && !supplierTaxId) warnings.push("No se pudo identificar el proveedor con confianza.");
  if (!supplierTaxId) warnings.push("No se pudo identificar el CIF/NIF del proveedor con confianza.");
  if (!supplierDocumentNumber) warnings.push("No se pudo identificar el numero de factura proveedor.");
  if (!totalAmount) warnings.push("No se pudo identificar el total con confianza.");

  const confidence = warnings.length === 0 ? "high" : warnings.length <= 2 ? "medium" : "low";
  return {
    supplierName,
    supplierTaxId,
    supplierEmail,
    supplierPhone,
    supplierAddress,
    supplierPostalCode,
    supplierCity,
    supplierProvince,
    supplierCountryCode: supplierTaxId ? "ES" : undefined,
    supplierDocumentNumber,
    currencyCode: "EUR",
    issueDate,
    dueDate,
    subtotalAmount: computedSubtotal,
    taxAmount,
    retentionAmount,
    totalAmount,
    lines: [
      {
        description: supplierDocumentNumber ? `Factura ${supplierDocumentNumber}` : "Gasto OCR",
        quantity: 1,
        unitPrice: computedSubtotal ?? totalAmount ?? 0,
        taxRate: Number.isFinite(taxRate) ? taxRate : 21,
        taxDeductiblePct: 100,
        retentionRate: Number.isFinite(retentionRate) ? retentionRate : 0,
      },
    ],
    confidence,
    warnings,
  };
}

async function extractPdfText(filePath: string) {
  const workerPath = pathToFileURL(path.join(/* turbopackIgnore: true */ process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs")).href;
  await importRuntimeModule(workerPath);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(/* turbopackIgnore: true */ filePath));
  const pdf = await pdfjs.getDocument({ data, useWorkerFetch: false, disableFontFace: true }).promise;
  if (pdf.numPages > maxPdfPages) throw new Error(`El PDF supera el máximo de ${maxPdfPages} páginas.`);
  const chunks: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let previousY: number | null = null;
    const pageLines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = "transform" in item && Array.isArray(item.transform) ? Number(item.transform[5]) : null;
      if (previousY !== null && y !== null && Math.abs(y - previousY) > 2) pageLines.push("\n");
      pageLines.push(item.str, " ");
      if (y !== null) previousY = y;
    }
    chunks.push(pageLines.join("").replace(/ +\n/g, "\n"));
  }
  const embeddedText = chunks.join("\n").trim();
  if (embeddedText.length >= 30) return embeddedText;

  const imageChunks: string[] = [];
  const importCanvas = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<typeof import("@napi-rs/canvas")>;
  const { createCanvas } = await importCanvas("@napi-rs/canvas");
  const worker = await createOcrWorker();
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      if (viewport.width * viewport.height > maxRenderedPixels) throw new Error("Una página del PDF supera el límite seguro de resolución.");
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context, viewport }).promise;
      const pngPath = `${filePath}.page-${pageNumber}.png`;
      await writeFile(pngPath, canvas.toBuffer("image/png"));
      try {
        const result = await worker.recognize(pngPath);
        imageChunks.push(result.data.text.trim());
      } finally {
        await rm(pngPath, { force: true });
      }
    }
  } finally {
    await worker.terminate();
  }
  return imageChunks.join("\n").trim();
}

async function createOcrWorker() {
  const { createWorker } = await import("tesseract.js");
  await mkdir(tesseractCachePath, { recursive: true });
  return createWorker("spa+eng", 1, {
    langPath: tessdataPath,
    cachePath: tesseractCachePath,
    gzip: true,
  });
}

async function extractImageText(filePath: string) {
  const importCanvas = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<typeof import("@napi-rs/canvas")>;
  const { loadImage } = await importCanvas("@napi-rs/canvas");
  const image = await loadImage(filePath);
  if (image.width * image.height > maxRenderedPixels) throw new Error("La imagen supera el límite seguro de resolución.");
  const worker = await createOcrWorker();
  try {
    const result = await worker.recognize(filePath);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}

export async function createExpenseOcrJob(input: {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
  initialStatus?: "PENDING" | "PROCESSING";
  batchId?: string;
  extractionProvider?: string;
  extractionModel?: string;
}) {
  if (!supportedContentTypes.has(input.contentType)) throw new Error("Formato no soportado. Usa PDF, PNG, JPG o WEBP.");
  assertFileSignature(input.contentType, input.buffer);
  if (input.batchId) {
    const [[ownedBatch], [jobCount]] = await Promise.all([
      db.select({ id: expenseIngestionBatch.id, expectedFiles: expenseIngestionBatch.expectedFiles })
        .from(expenseIngestionBatch)
        .where(and(eq(expenseIngestionBatch.id, input.batchId), eq(expenseIngestionBatch.companyId, input.companyId)))
        .limit(1),
      db.select({ count: sql<number>`count(*)::int` })
        .from(expenseOcrJob)
        .where(and(eq(expenseOcrJob.batchId, input.batchId), eq(expenseOcrJob.companyId, input.companyId))),
    ]);
    if (!ownedBatch) throw new Error("El lote OCR no pertenece a la empresa activa.");
    if (Number(jobCount?.count ?? 0) >= ownedBatch.expectedFiles) throw new Error("El lote ya alcanzó el número de archivos previsto.");
  }
  const documentSha256 = createHash("sha256").update(input.buffer).digest("hex");
  const [created] = await db
    .insert(expenseOcrJob)
    .values({
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      batchId: input.batchId ?? null,
      status: input.initialStatus ?? "PENDING",
      fileName: sanitizeFileName(input.fileName),
      filePath: "pending",
      contentType: input.contentType,
      sizeBytes: input.buffer.byteLength,
      documentSha256,
      attempts: input.initialStatus === "PROCESSING" ? 1 : 0,
      startedAt: input.initialStatus === "PROCESSING" ? new Date() : null,
      leaseExpiresAt: input.initialStatus === "PROCESSING" ? new Date(Date.now() + jobLeaseMs) : null,
      extractionProvider: input.extractionProvider ?? null,
      extractionModel: input.extractionModel ?? null,
    })
    .returning({ id: expenseOcrJob.id });
  const dir = path.join(uploadRoot, input.companyId, "expense-ocr");
  const filePath = path.join(dir, `${created.id}-${sanitizeFileName(input.fileName)}`);
  const fileUrl = `/api/expenses/ocr/${created.id}/file`;
  const objectKey = `${input.tenantId}/${input.companyId}/expense-ocr/${created.id}-${sanitizeFileName(input.fileName)}`;
  let storageKey = `local:${objectKey}`;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, input.buffer);
    await scanUploadedFile(filePath);
    if (isObjectStorageConfigured()) {
      await putPrivateObject(objectKey, input.contentType, input.buffer);
      storageKey = `s3:${objectKey}`;
      await rm(filePath, { force: true });
    }
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined);
    await db.delete(expenseOcrJob).where(eq(expenseOcrJob.id, created.id));
    throw error;
  }
  const [updated] = await db
    .update(expenseOcrJob)
    .set({ filePath, fileUrl, storageKey })
    .where(and(eq(expenseOcrJob.companyId, input.companyId), eq(expenseOcrJob.id, created.id)))
    .returning();
  return updated;
}

export async function createExpenseOcrBatch(input: {
  tenantId: string;
  companyId: string;
  actorUserId: string;
  expectedFiles: number;
}) {
  const expectedFiles = Math.min(Math.max(Math.trunc(input.expectedFiles), 1), 50);
  const [batch] = await db
    .insert(expenseIngestionBatch)
    .values({ ...input, expectedFiles, status: "OPEN" })
    .returning();
  return batch;
}

export async function readExpenseOcrFile(job: { filePath: string; storageKey: string | null }) {
  try {
    return await readFile(/* turbopackIgnore: true */ job.filePath);
  } catch (error) {
    if (job.storageKey?.startsWith("s3:")) return readPrivateObject(job.storageKey.slice(3));
    throw error;
  }
}

export async function completeExpenseOcrJob(
  jobId: string,
  draft: ExpenseOcrDraft,
  sourceText?: string,
  extraction?: { provider?: string; model?: string },
) {
  const [updated] = await db
    .update(expenseOcrJob)
    .set({
      status: "DONE",
      extractedJson: JSON.stringify(draft),
      sourceText: persistedSourceText(sourceText),
      extractionProvider: extraction?.provider ?? null,
      extractionModel: extraction?.model ?? null,
      errorMessage: null,
      leaseExpiresAt: null,
      finishedAt: new Date(),
    })
    .where(eq(expenseOcrJob.id, jobId))
    .returning();
  return updated ?? null;
}

export async function failExpenseOcrJob(jobId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Error inesperado procesando OCR.";
  const [updated] = await db
    .update(expenseOcrJob)
    .set({ status: "FAILED", errorMessage: message.slice(0, 2_000), leaseExpiresAt: null, finishedAt: new Date() })
    .where(eq(expenseOcrJob.id, jobId))
    .returning();
  return updated ?? null;
}

export async function processExpenseOcrJob(jobId: string) {
  const now = new Date();
  const [job] = await db
    .update(expenseOcrJob)
    .set({
      status: "PROCESSING",
      startedAt: now,
      finishedAt: null,
      errorMessage: null,
      leaseExpiresAt: new Date(now.getTime() + jobLeaseMs),
      attempts: sql`${expenseOcrJob.attempts} + 1`,
    })
    .where(and(
      eq(expenseOcrJob.id, jobId),
      or(
        and(inArray(expenseOcrJob.status, ["PENDING", "FAILED"]), lt(expenseOcrJob.attempts, maxJobAttempts)),
        and(eq(expenseOcrJob.status, "PROCESSING"), sql`${expenseOcrJob.attempts} < ${maxJobAttempts}`, or(isNull(expenseOcrJob.leaseExpiresAt), lt(expenseOcrJob.leaseExpiresAt, now))),
      ),
    ))
    .returning();
  if (!job) return null;
  logger.info({ jobId: job.id, attempt: job.attempts, batchId: job.batchId }, "expense_ocr.processing_started");

  let processingPath = job.filePath;
  let temporaryDirectory: string | null = null;
  try {
    try {
      await readFile(/* turbopackIgnore: true */ processingPath);
    } catch {
      const data = await readExpenseOcrFile(job);
      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "expense-ocr-"));
      processingPath = path.join(temporaryDirectory, sanitizeFileName(job.fileName));
      await writeFile(processingPath, data);
    }
    const sourceText = job.contentType === "application/pdf"
      ? await extractPdfText(processingPath)
      : await extractImageText(processingPath);
    if (!sourceText || sourceText.length < 10) {
      throw new Error(job.contentType === "application/pdf"
        ? "No se ha extraido texto del PDF. Si es un PDF escaneado, sube la pagina como imagen o instala renderizado PDF OCR en el worker."
        : "No se ha extraido texto suficiente de la imagen.");
    }
    const draft = parseExpenseOcrText(sourceText);
    const [updated] = await db
      .update(expenseOcrJob)
      .set({
        status: "DONE",
        sourceText: persistedSourceText(sourceText),
        extractedJson: JSON.stringify(draft),
        extractionProvider: "tesseract",
        extractionModel: "spa+eng",
        leaseExpiresAt: null,
        finishedAt: new Date(),
      })
      .where(eq(expenseOcrJob.id, jobId))
      .returning();
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado procesando OCR.";
    logger.error({ jobId: job.id, attempt: job.attempts, error: message }, "expense_ocr.processing_failed");
    const [updated] = await db
      .update(expenseOcrJob)
      .set({ status: "FAILED", errorMessage: message.slice(0, 2_000), leaseExpiresAt: null, finishedAt: new Date() })
      .where(eq(expenseOcrJob.id, jobId))
      .returning();
    return updated;
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function getExpenseOcrJob(companyId: string, id: string) {
  const [job] = await db.select().from(expenseOcrJob).where(and(eq(expenseOcrJob.companyId, companyId), eq(expenseOcrJob.id, id))).limit(1);
  if (!job) return null;
  return {
    ...job,
    extracted: job.extractedJson ? JSON.parse(job.extractedJson) as ExpenseOcrDraft : null,
  };
}

export async function retryExpenseOcrJob(companyId: string, id: string) {
  const [job] = await db
    .update(expenseOcrJob)
    .set({ status: "PENDING", attempts: 0, startedAt: null, finishedAt: null, leaseExpiresAt: null, errorMessage: null })
    .where(and(eq(expenseOcrJob.companyId, companyId), eq(expenseOcrJob.id, id), eq(expenseOcrJob.status, "FAILED")))
    .returning();
  return job ?? null;
}

export async function listRecentExpenseOcrJobs(companyId: string) {
  return db
    .select({
      id: expenseOcrJob.id,
      status: expenseOcrJob.status,
      fileName: expenseOcrJob.fileName,
      createdAt: expenseOcrJob.createdAt,
      finishedAt: expenseOcrJob.finishedAt,
      errorMessage: expenseOcrJob.errorMessage,
      batchId: expenseOcrJob.batchId,
      supplierInvoiceId: expenseOcrJob.supplierInvoiceId,
    })
    .from(expenseOcrJob)
    .where(eq(expenseOcrJob.companyId, companyId))
    .orderBy(desc(expenseOcrJob.createdAt))
    .limit(10);
}

export async function processPendingExpenseOcrJobs(limit = 3) {
  const now = new Date();
  await db
    .update(expenseOcrJob)
    .set({ status: "FAILED", leaseExpiresAt: null, finishedAt: now, errorMessage: "El OCR agotó el máximo de reintentos automáticos." })
    .where(and(eq(expenseOcrJob.status, "PROCESSING"), lt(expenseOcrJob.leaseExpiresAt, now), sql`${expenseOcrJob.attempts} >= ${maxJobAttempts}`));
  const jobs = await db
    .select({ id: expenseOcrJob.id })
    .from(expenseOcrJob)
    .where(or(
      and(eq(expenseOcrJob.status, "PENDING"), lt(expenseOcrJob.attempts, maxJobAttempts)),
      and(eq(expenseOcrJob.status, "PROCESSING"), sql`${expenseOcrJob.attempts} < ${maxJobAttempts}`, or(isNull(expenseOcrJob.leaseExpiresAt), lt(expenseOcrJob.leaseExpiresAt, now))),
    ))
    .orderBy(asc(expenseOcrJob.createdAt))
    .limit(limit);
  for (const job of jobs) {
    await processExpenseOcrJob(job.id);
  }
  return jobs.length;
}

export async function cleanupExpiredExpenseOcrJobs(retentionDays = Number(process.env.OCR_ORPHAN_RETENTION_DAYS ?? 30)) {
  const cutoff = new Date(Date.now() - Math.max(retentionDays, 1) * 24 * 60 * 60 * 1000);
  const jobs = await db
    .select({ id: expenseOcrJob.id, filePath: expenseOcrJob.filePath, storageKey: expenseOcrJob.storageKey })
    .from(expenseOcrJob)
    .where(and(
      isNull(expenseOcrJob.supplierInvoiceId),
      lt(expenseOcrJob.createdAt, cutoff),
      inArray(expenseOcrJob.status, ["DONE", "FAILED"]),
    ))
    .limit(100);
  for (const job of jobs) {
    await rm(job.filePath, { force: true }).catch(() => undefined);
    if (job.storageKey?.startsWith("s3:")) await deletePrivateObject(job.storageKey.slice(3)).catch(() => undefined);
    await db.delete(expenseOcrJob).where(and(eq(expenseOcrJob.id, job.id), isNull(expenseOcrJob.supplierInvoiceId)));
  }
  if (jobs.length > 0) logger.info({ count: jobs.length }, "expense_ocr.orphans_cleaned");
  return jobs.length;
}

export async function getExpenseOcrBatch(companyId: string, batchId: string) {
  const [batch] = await db
    .select()
    .from(expenseIngestionBatch)
    .where(and(eq(expenseIngestionBatch.companyId, companyId), eq(expenseIngestionBatch.id, batchId)))
    .limit(1);
  if (!batch) return null;
  const jobs = await db
    .select()
    .from(expenseOcrJob)
    .where(and(eq(expenseOcrJob.companyId, companyId), eq(expenseOcrJob.batchId, batchId)))
    .orderBy(asc(expenseOcrJob.createdAt));
  const completed = jobs.filter((job) => job.status === "DONE" || job.status === "FAILED").length;
  const posted = jobs.filter((job) => Boolean(job.supplierInvoiceId)).length;
  const status = jobs.length >= batch.expectedFiles && posted === jobs.length
    ? "COMPLETED"
    : jobs.length >= batch.expectedFiles && completed === jobs.length
      ? "READY"
      : "PROCESSING";
  if (status !== batch.status) {
    await db.update(expenseIngestionBatch).set({ status, updatedAt: new Date() }).where(eq(expenseIngestionBatch.id, batch.id));
  }
  return {
    ...batch,
    status,
    counts: { uploaded: jobs.length, completed, posted, failed: jobs.filter((job) => job.status === "FAILED").length },
    jobs: jobs.map((job) => ({
      ...job,
      sourceText: undefined,
      extractedJson: undefined,
      extracted: job.extractedJson ? JSON.parse(job.extractedJson) as ExpenseOcrDraft : null,
    })),
  };
}
