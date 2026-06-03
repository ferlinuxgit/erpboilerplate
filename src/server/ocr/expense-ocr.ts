import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, desc, eq } from "drizzle-orm";

import { expenseOcrJob } from "@/db/schema";
import { db } from "@/lib/db";

export type ExpenseOcrStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

export type ExpenseOcrDraftLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  taxDeductiblePct: number;
  retentionRate: number;
};

export type ExpenseOcrDraft = {
  supplierName?: string;
  supplierDocumentNumber?: string;
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

const uploadRoot = process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), ".data", "uploads");
const tessdataPath = process.env.TESSDATA_PREFIX || path.join(process.cwd(), "public", "ocr", "lang");
const tesseractCachePath = process.env.TESSERACT_CACHE_DIR || path.join(process.cwd(), ".data", "tesseract-cache");
const supportedContentTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

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
  return new Date(Date.UTC(year, month - 1, day, 12)).toISOString();
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

export function parseExpenseOcrText(text: string): ExpenseOcrDraft {
  const cleanText = text.replace(/\u00a0/g, " ");
  const lines = cleanText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const supplierName = firstMatch(cleanText, [
    /(?:proveedor|emisor|supplier|vendor)\s*:?\s*([^\n]+)/i,
    /(?:raz[oó]n social)\s*:?\s*([^\n]+)/i,
  ]) ?? inferSupplierName(lines);
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
  if (!supplierName) warnings.push("No se pudo identificar el proveedor con confianza.");
  if (!supplierDocumentNumber) warnings.push("No se pudo identificar el numero de factura proveedor.");
  if (!totalAmount) warnings.push("No se pudo identificar el total con confianza.");

  const confidence = warnings.length === 0 ? "high" : warnings.length <= 2 ? "medium" : "low";
  return {
    supplierName,
    supplierDocumentNumber,
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
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(filePath));
  const pdf = await pdfjs.getDocument({ data, useWorkerFetch: false, disableFontFace: true }).promise;
  const chunks: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    chunks.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
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
}) {
  if (!supportedContentTypes.has(input.contentType)) throw new Error("Formato no soportado. Usa PDF, PNG, JPG o WEBP.");
  const [created] = await db
    .insert(expenseOcrJob)
    .values({
      tenantId: input.tenantId,
      companyId: input.companyId,
      actorUserId: input.actorUserId,
      status: "PENDING",
      fileName: sanitizeFileName(input.fileName),
      filePath: "pending",
      contentType: input.contentType,
    })
    .returning({ id: expenseOcrJob.id });
  const dir = path.join(uploadRoot, input.companyId, "expense-ocr");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${created.id}-${sanitizeFileName(input.fileName)}`);
  await writeFile(filePath, input.buffer);
  const fileUrl = `/api/expenses/ocr/${created.id}/file`;
  const [updated] = await db
    .update(expenseOcrJob)
    .set({ filePath, fileUrl })
    .where(and(eq(expenseOcrJob.companyId, input.companyId), eq(expenseOcrJob.id, created.id)))
    .returning();
  return updated;
}

export async function processExpenseOcrJob(jobId: string) {
  const [job] = await db.select().from(expenseOcrJob).where(eq(expenseOcrJob.id, jobId)).limit(1);
  if (!job || job.status === "PROCESSING") return null;
  await db.update(expenseOcrJob).set({ status: "PROCESSING", startedAt: new Date(), errorMessage: null }).where(eq(expenseOcrJob.id, jobId));
  try {
    const sourceText = job.contentType === "application/pdf"
      ? await extractPdfText(job.filePath)
      : await extractImageText(job.filePath);
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
        sourceText,
        extractedJson: JSON.stringify(draft),
        finishedAt: new Date(),
      })
      .where(eq(expenseOcrJob.id, jobId))
      .returning();
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado procesando OCR.";
    const [updated] = await db
      .update(expenseOcrJob)
      .set({ status: "FAILED", errorMessage: message, finishedAt: new Date() })
      .where(eq(expenseOcrJob.id, jobId))
      .returning();
    return updated;
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

export async function listRecentExpenseOcrJobs(companyId: string) {
  return db
    .select({
      id: expenseOcrJob.id,
      status: expenseOcrJob.status,
      fileName: expenseOcrJob.fileName,
      createdAt: expenseOcrJob.createdAt,
      finishedAt: expenseOcrJob.finishedAt,
      errorMessage: expenseOcrJob.errorMessage,
    })
    .from(expenseOcrJob)
    .where(eq(expenseOcrJob.companyId, companyId))
    .orderBy(desc(expenseOcrJob.createdAt))
    .limit(10);
}

export async function processPendingExpenseOcrJobs(limit = 3) {
  const jobs = await db
    .select({ id: expenseOcrJob.id })
    .from(expenseOcrJob)
    .where(eq(expenseOcrJob.status, "PENDING"))
    .orderBy(expenseOcrJob.createdAt)
    .limit(limit);
  for (const job of jobs) {
    await processExpenseOcrJob(job.id);
  }
  return jobs.length;
}
