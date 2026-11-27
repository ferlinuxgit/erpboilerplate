import { and, asc, desc, eq, sql } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";

import { accountChart, company, journalEntry, journalLine, officialBookSubmission, partner } from "@/db/schema";
import { db } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { annualAccountsSections } from "@/server/accounting/annual-accounts/documents";
import { loadAnnualAccounts } from "@/server/accounting/annual-accounts/service";
import {
  bookEntryKind,
  fileFingerprint,
  journalTotals,
  ledgerFingerprint,
  orderJournal,
  outOfOrderNumbers,
  type AccountBalance,
  type BookEntry,
  type OrderedBookEntry,
} from "@/server/accounting/books/books-model";
import { renderDocumentXlsx, type BookDocument } from "@/server/accounting/books/document";
import { inventoryBookDocument, journalDocument, ledgerDocument, type BookHeader } from "@/server/accounting/books/documents";
import { buildSuenlace, buildXDiario, buildXSubCta, type SubaccountExportRow } from "@/server/accounting/books/exports-model";
import { accountingDay, accountingRange, companyTimeZoneOf, fiscalYearAccountingRange, postedBeforeSql, postedInRangeSql } from "@/server/accounting/fiscal-year-date";
import { listFiscalYears } from "@/server/accounting/fiscal-years";
import { toCents } from "@/server/accounting/money";
import { recordAudit } from "@/server/audit";

export type BookKind = "journal" | "inventory" | "ledger";
export type BookFormat = "xlsx" | "pdf";

/** Prefijo del nombre de fichero: los códigos de tipo de libro del anexo I de la Instrucción de la DGRN de 12-02-2015. */
const BOOK_FILE_PREFIX: Record<BookKind, string> = { journal: "DIARIO", inventory: "INV_CUEN", ledger: "MAYOR" };
export const BOOK_LABEL: Record<BookKind, string> = { journal: "Libro Diario", inventory: "Libro de Inventarios y Cuentas Anuales", ledger: "Libro Mayor" };
const CONTENT_TYPE: Record<BookFormat, string> = { xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" };

export type BookData = {
  header: BookHeader;
  fiscalYearId: string;
  journal: OrderedBookEntry[];
  prior: AccountBalance[];
};

/** Asientos del ejercicio (en hora local, con apertura, regularización y cierre) y saldos anteriores. */
export async function loadBookData(companyId: string, fiscalYearId: string): Promise<BookData> {
  const [companyRow] = await db
    .select({ name: company.name, legalName: company.legalName, vatNumber: company.vatNumber, countryCode: company.countryCode, postalCode: company.postalCode, province: company.province })
    .from(company)
    .where(eq(company.id, companyId))
    .limit(1);
  const year = (await listFiscalYears(companyId)).find((candidate) => candidate.id === fiscalYearId);
  if (!companyRow || !year) throw new HttpError(404, "Ejercicio no encontrado.");
  const timeZone = companyTimeZoneOf(companyRow);
  const range = fiscalYearAccountingRange(year, timeZone);

  const lines = await db
    .select({
      entryId: journalEntry.id,
      number: journalEntry.number,
      postedAt: journalEntry.postedAt,
      reference: journalEntry.reference,
      sourceType: journalEntry.sourceType,
      accountId: accountChart.id,
      accountCode: accountChart.code,
      accountName: accountChart.name,
      concept: journalLine.concept,
      debit: journalLine.debit,
      credit: journalLine.credit,
    })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(eq(journalEntry.companyId, companyId), postedInRangeSql(range)))
    .orderBy(asc(journalEntry.postedAt), asc(journalEntry.number), asc(journalLine.lineNumber), asc(journalLine.id));

  const entries = new Map<string, BookEntry>();
  for (const line of lines) {
    let entry = entries.get(line.entryId);
    if (!entry) {
      const kind = bookEntryKind(line.sourceType);
      // Los asientos del ciclo se fechan por su día civil (ver `fiscal-year-date.ts`); el resto, en hora local.
      const day = (kind === "normal" ? accountingDay(line.postedAt, timeZone) : new Date(Math.floor(line.postedAt.getTime() / 86_400_000) * 86_400_000)).toISOString().slice(0, 10);
      entry = { id: line.entryId, number: line.number, postedAt: line.postedAt, day, reference: line.reference, kind, lines: [] };
      entries.set(line.entryId, entry);
    }
    entry.lines.push({ accountId: line.accountId, accountCode: line.accountCode, accountName: line.accountName, concept: line.concept, debitCents: toCents(line.debit), creditCents: toCents(line.credit) });
  }

  // Saldos anteriores al ejercicio (todos los asientos, también los de cierre: si el ejercicio
  // anterior se cerró quedan a cero y los trae el asiento de apertura).
  const before = accountingRange({ toExclusive: year.startsAt }, timeZone);
  const priorRows = await db
    .select({ accountId: accountChart.id, code: accountChart.code, name: accountChart.name, balance: sql<string>`coalesce(sum(${journalLine.debit} - ${journalLine.credit}), 0)` })
    .from(journalLine)
    .innerJoin(journalEntry, eq(journalEntry.id, journalLine.journalEntryId))
    .innerJoin(accountChart, eq(accountChart.id, journalLine.accountId))
    .where(and(eq(journalEntry.companyId, companyId), postedBeforeSql(before, "toExclusive")))
    .groupBy(accountChart.id, accountChart.code, accountChart.name);

  return {
    header: { companyName: companyRow.legalName || companyRow.name, taxId: companyRow.vatNumber, yearCode: year.code, startsAt: year.startsAt, endsAt: year.endsAt },
    fiscalYearId,
    journal: orderJournal([...entries.values()]),
    prior: priorRows.map((row) => ({ accountId: row.accountId, code: row.code, name: row.name, balanceCents: toCents(row.balance) })).filter((row) => row.balanceCents !== 0),
  };
}

async function bookDocument(companyId: string, data: BookData, kind: BookKind): Promise<BookDocument> {
  if (kind === "journal") return journalDocument(data.header, data.journal);
  if (kind === "ledger") return ledgerDocument(data.header, data.journal, data.prior);
  const annualAccounts = await loadAnnualAccounts(companyId, data.fiscalYearId);
  return inventoryBookDocument(data.header, data.journal, data.prior, annualAccountsSections(annualAccounts));
}

async function renderDocument(document: BookDocument, format: BookFormat, generatedAt: Date) {
  if (format === "xlsx") return renderDocumentXlsx(document, generatedAt);
  // El PDF solo se carga cuando se pide: `@react-pdf/renderer` es pesado.
  const { renderDocumentPdf } = await import("@/server/accounting/books/document-pdf");
  return renderDocumentPdf(document, generatedAt);
}

const bookFileName = (kind: BookKind, yearCode: string, format: BookFormat) => `${BOOK_FILE_PREFIX[kind]}_${yearCode.replace(/[^0-9A-Za-z-]/g, "")}.${format}`;

/** Un libro suelto, para revisarlo (no queda registrado como juego para legalizar). */
export async function generateBook(input: { companyId: string; fiscalYearId: string; kind: BookKind; format: BookFormat }) {
  const data = await loadBookData(input.companyId, input.fiscalYearId);
  const bytes = await renderDocument(await bookDocument(input.companyId, data, input.kind), input.format, new Date());
  return { bytes, fileName: bookFileName(input.kind, data.header.yearCode, input.format), contentType: CONTENT_TYPE[input.format] };
}

export type BookFileRecord = { name: string; book: string; bytes: number; sha256Hex: string; sha256Base64: string };

/** Relación de huellas (texto) que acompaña a los ficheros. */
export function fingerprintsText(header: BookHeader, files: BookFileRecord[], generatedAt: Date) {
  const lines = [
    "RELACIÓN DE LIBROS Y HUELLAS DIGITALES (SHA-256)",
    "",
    `Empresa: ${header.companyName}${header.taxId ? ` (NIF ${header.taxId})` : ""}`,
    `Ejercicio: ${header.yearCode} (${header.startsAt.toISOString().slice(0, 10)} a ${header.endsAt.toISOString().slice(0, 10)})`,
    `Generado: ${generatedAt.toISOString()}`,
    "",
  ];
  for (const file of files) {
    lines.push(`${file.book}`, `  Fichero: ${file.name} (${file.bytes} bytes)`, `  SHA-256 (hexadecimal): ${file.sha256Hex}`, `  SHA-256 (base64):      ${file.sha256Base64}`, "");
  }
  lines.push("Legalia 2 calcula la huella de cada fichero al cargarlo: debe coincidir con la de esta relación.", "Si no coincide, el fichero se ha modificado (basta con abrirlo y guardarlo en Excel). Vuelve a descargar el juego.");
  return lines.join("\r\n");
}

/** Instrucciones para presentar los libros con Legalia 2 (no se genera su fichero de envío). */
export function legaliaInstructions(header: BookHeader, files: BookFileRecord[]) {
  const open = header.startsAt.toISOString().slice(0, 10).split("-").reverse().join("/");
  const close = header.endsAt.toISOString().slice(0, 10).split("-").reverse().join("/");
  return [
    "CÓMO PRESENTAR ESTOS LIBROS EN EL REGISTRO MERCANTIL CON LEGALIA 2",
    "",
    "Plazo: dentro de los cuatro meses siguientes al cierre del ejercicio (art. 27 del Código de Comercio y art. 18 de la Ley 14/2013).",
    "La presentación es telemática (Instrucción de la DGRN de 12 de febrero de 2015, BOE-A-2015-1481).",
    "",
    "1. Descarga e instala Legalia 2 desde la web del Colegio de Registradores (registradores.org).",
    "2. Crea una legalización nueva con los datos de la empresa (denominación, NIF, datos registrales) y del presentante.",
    "3. Añade un libro por cada fichero de este ZIP, eligiendo su tipo en el desplegable:",
    ...files.map((file) => `     - ${file.name}  →  tipo «${file.book}»`),
    `   En cada uno indica: número de orden del libro, fecha de apertura ${open} y fecha de cierre ${close},`,
    "   y la fecha de cierre del último libro legalizado de ese tipo (si lo hay).",
    "4. NO abras ni guardes los ficheros antes de cargarlos: cualquier cambio altera la huella.",
    "5. Legalia 2 muestra la huella SHA-256 de cada libro: comprueba que coincide con HUELLAS.txt.",
    "6. Genera el fichero de envío (ZIP) con Legalia 2, fírmalo y preséntalo en la sede electrónica de los Registradores.",
    "7. Conserva este ZIP: el empresario debe guardar una copia idéntica de los libros presentados.",
    "8. Cuando el Registro lo admita, anota la fecha y el número de entrada en Contabilidad › Libros oficiales.",
    "",
    "Formatos: Legalia 2 admite PDF y Excel (XLSX), entre otros. El Libro Mayor es un libro auxiliar: su legalización es voluntaria.",
    "Este programa no genera el fichero de envío de Legalia 2 (DATOS.TXT y NOMBRES.TXT): lo crea el propio Legalia 2 al cargar los libros.",
  ].join("\r\n");
}

/**
 * Juego completo para legalizar: Diario, Inventarios y Cuentas Anuales y Mayor en el formato pedido,
 * con la relación de huellas y las instrucciones, en un ZIP. Queda anotado (estado «generated») con
 * las huellas y la huella del contenido contable, para poder registrar después la presentación y
 * avisar si el ejercicio cambia.
 */
export async function generateBooksPackage(input: { companyId: string; tenantId: string; actorUserId: string; fiscalYearId: string; format: BookFormat }) {
  const data = await loadBookData(input.companyId, input.fiscalYearId);
  if (data.journal.length === 0) throw new HttpError(422, "El ejercicio no tiene asientos: no hay libros que generar.");
  const totals = journalTotals(data.journal);
  if (totals.debitCents !== totals.creditCents) throw new HttpError(422, "El Libro Diario no cuadra (el debe y el haber no suman lo mismo). Revisa los asientos antes de generar los libros.");
  const generatedAt = new Date();
  const zipEntries: Record<string, Uint8Array> = {};
  const files: BookFileRecord[] = [];
  for (const kind of ["journal", "inventory", "ledger"] as const) {
    const bytes = await renderDocument(await bookDocument(input.companyId, data, kind), input.format, generatedAt);
    const name = bookFileName(kind, data.header.yearCode, input.format);
    zipEntries[name] = bytes;
    files.push({ name, book: BOOK_LABEL[kind], bytes: bytes.byteLength, ...fileFingerprint(bytes) });
  }
  zipEntries["HUELLAS.txt"] = strToU8(fingerprintsText(data.header, files, generatedAt));
  zipEntries["INSTRUCCIONES_LEGALIA2.txt"] = strToU8(legaliaInstructions(data.header, files));
  const fingerprint = ledgerFingerprint(data.journal);

  const submissionId = await db.transaction(async (tx) => {
    // Un solo juego sin presentar por ejercicio: el nuevo sustituye al anterior.
    await tx.delete(officialBookSubmission).where(and(eq(officialBookSubmission.companyId, input.companyId), eq(officialBookSubmission.fiscalYearId, input.fiscalYearId), eq(officialBookSubmission.status, "generated")));
    const [created] = await tx
      .insert(officialBookSubmission)
      .values({ companyId: input.companyId, fiscalYearId: input.fiscalYearId, files, ledgerFingerprint: fingerprint, entryCount: data.journal.length, generatedAt, generatedByUserId: input.actorUserId })
      .returning({ id: officialBookSubmission.id });
    await recordAudit({ tenantId: input.tenantId, companyId: input.companyId, actorUserId: input.actorUserId, action: "accounting.books.generate", entityName: "fiscalYear", entityId: input.fiscalYearId, payload: { format: input.format, files: files.map((file) => ({ name: file.name, sha256: file.sha256Hex })), ledgerFingerprint: fingerprint } }, tx);
    return created.id;
  });

  return {
    submissionId,
    bytes: zipSync(zipEntries, { level: 6, mtime: generatedAt }),
    fileName: `libros-oficiales-${data.header.yearCode.replace(/[^0-9A-Za-z-]/g, "")}.zip`,
    files,
  };
}

export type BooksOverview = Awaited<ReturnType<typeof getBooksOverview>>;

/** Estado de los libros de un ejercicio: totales del Diario, juegos generados o presentados y avisos. */
export async function getBooksOverview(companyId: string, fiscalYearId: string) {
  const data = await loadBookData(companyId, fiscalYearId);
  const submissions = await db
    .select()
    .from(officialBookSubmission)
    .where(and(eq(officialBookSubmission.companyId, companyId), eq(officialBookSubmission.fiscalYearId, fiscalYearId)))
    .orderBy(desc(officialBookSubmission.generatedAt));
  const fingerprint = ledgerFingerprint(data.journal);
  const totals = journalTotals(data.journal);
  const submitted = submissions.find((submission) => submission.status === "submitted") ?? null;
  return {
    header: data.header,
    totals: { entries: totals.entries, lines: totals.lines, debit: totals.debitCents / 100, credit: totals.creditCents / 100 },
    balanced: totals.debitCents === totals.creditCents,
    outOfOrder: outOfOrderNumbers(data.journal),
    hasOpening: data.journal.some((entry) => entry.kind === "opening"),
    hasRegularization: data.journal.some((entry) => entry.kind === "regularization"),
    hasClosing: data.journal.some((entry) => entry.kind === "closing"),
    submissions: submissions.map((submission) => ({
      id: submission.id,
      status: submission.status as "generated" | "submitted",
      files: submission.files,
      entryCount: submission.entryCount,
      generatedAt: submission.generatedAt.toISOString(),
      submittedAt: submission.submittedAt,
      registryName: submission.registryName,
      submissionReference: submission.submissionReference,
      notes: submission.notes,
      /** El ejercicio ya no coincide con lo que contenían estos ficheros. */
      changedSince: submission.ledgerFingerprint !== fingerprint,
    })),
    /** Ejercicio legalizado y modificado después: hay que avisar al Registro o rectificar. */
    legalizedAndChanged: submitted ? submitted.ledgerFingerprint !== fingerprint : false,
    legalized: Boolean(submitted),
  };
}

/** Anota la presentación de un juego de libros en el Registro Mercantil. */
export async function registerBooksSubmission(input: { companyId: string; tenantId: string; actorUserId: string; submissionId: string; submittedAt: string; registryName?: string | null; submissionReference?: string | null; notes?: string | null }) {
  const [updated] = await db
    .update(officialBookSubmission)
    .set({ status: "submitted", submittedAt: input.submittedAt, registryName: input.registryName?.trim() || null, submissionReference: input.submissionReference?.trim() || null, notes: input.notes?.trim() || null })
    .where(and(eq(officialBookSubmission.id, input.submissionId), eq(officialBookSubmission.companyId, input.companyId)))
    .returning({ id: officialBookSubmission.id, fiscalYearId: officialBookSubmission.fiscalYearId, files: officialBookSubmission.files });
  if (!updated) throw new HttpError(404, "No se ha encontrado ese juego de libros. Genera los libros de nuevo.");
  await recordAudit({ tenantId: input.tenantId, companyId: input.companyId, actorUserId: input.actorUserId, action: "accounting.books.submit", entityName: "fiscalYear", entityId: updated.fiscalYearId, payload: { submissionId: updated.id, submittedAt: input.submittedAt, registryName: input.registryName ?? null, reference: input.submissionReference ?? null, files: updated.files.map((file) => ({ name: file.name, sha256: file.sha256Hex })) } });
  return updated;
}

/** Deshace la anotación de una presentación (p. ej. registrada por error): vuelve a «generated». */
export async function unregisterBooksSubmission(input: { companyId: string; tenantId: string; actorUserId: string; submissionId: string }) {
  const [updated] = await db
    .update(officialBookSubmission)
    .set({ status: "generated", submittedAt: null, registryName: null, submissionReference: null })
    .where(and(eq(officialBookSubmission.id, input.submissionId), eq(officialBookSubmission.companyId, input.companyId), eq(officialBookSubmission.status, "submitted")))
    .returning({ id: officialBookSubmission.id, fiscalYearId: officialBookSubmission.fiscalYearId });
  if (!updated) throw new HttpError(404, "No se ha encontrado esa presentación.");
  await recordAudit({ tenantId: input.tenantId, companyId: input.companyId, actorUserId: input.actorUserId, action: "accounting.books.unsubmit", entityName: "fiscalYear", entityId: updated.fiscalYearId, payload: { submissionId: updated.id } });
  return updated;
}

/**
 * ¿Están legalizados los libros del ejercicio? Para avisar antes de modificarlo (reapertura, asientos
 * con fecha de ese ejercicio): un libro legalizado no se puede cambiar; las correcciones se hacen en
 * el ejercicio en curso o rectificando la legalización ante el Registro.
 */
export async function findBooksLegalization(companyId: string, fiscalYearId: string, client: Pick<typeof db, "select"> = db) {
  const [row] = await client
    .select({ id: officialBookSubmission.id, submittedAt: officialBookSubmission.submittedAt, registryName: officialBookSubmission.registryName })
    .from(officialBookSubmission)
    .where(and(eq(officialBookSubmission.companyId, companyId), eq(officialBookSubmission.fiscalYearId, fiscalYearId), eq(officialBookSubmission.status, "submitted")))
    .orderBy(desc(officialBookSubmission.submittedAt))
    .limit(1);
  return row ?? null;
}

export type DiaryExportFormat = "a3" | "contaplus";

/** Diario del ejercicio para programas de despacho: A3 (`SUENLACE.DAT`) o ContaPlus (ZIP con `XDiario.txt` y `XSubCta.txt`). */
export async function exportDiary(input: { companyId: string; tenantId: string; actorUserId: string; fiscalYearId: string; format: DiaryExportFormat; a3CompanyCode?: number }) {
  const data = await loadBookData(input.companyId, input.fiscalYearId);
  if (data.journal.length === 0) throw new HttpError(422, "El ejercicio no tiene asientos que exportar.");
  let result: { bytes: Uint8Array; fileName: string; contentType: string };
  try {
    if (input.format === "a3") {
      result = { bytes: strToU8(buildSuenlace(data.journal, { companyCode: input.a3CompanyCode ?? 0 })), fileName: "SUENLACE.DAT", contentType: "application/octet-stream" };
    } else {
      const partners = await db
        .select({ code: accountChart.code, taxId: partner.taxId, address: partner.address, city: partner.city, province: partner.province, postalCode: partner.postalCode })
        .from(accountChart)
        .innerJoin(partner, eq(partner.id, accountChart.partnerId))
        .where(eq(accountChart.companyId, input.companyId));
      const partnerByCode = new Map(partners.map((row) => [row.code, row]));
      const accounts = new Map<string, SubaccountExportRow>();
      for (const entry of data.journal) {
        for (const line of entry.lines) {
          if (!accounts.has(line.accountCode)) accounts.set(line.accountCode, { code: line.accountCode, name: line.accountName, ...partnerByCode.get(line.accountCode) });
        }
      }
      const year = data.header.yearCode.replace(/[^0-9A-Za-z-]/g, "");
      result = {
        bytes: zipSync({ "XDiario.txt": strToU8(buildXDiario(data.journal)), "XSubCta.txt": strToU8(buildXSubCta([...accounts.values()])) }, { level: 6 }),
        fileName: `contaplus-${year}.zip`,
        contentType: "application/zip",
      };
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(422, error instanceof Error ? error.message : "No se pudo generar la exportación.");
  }
  await recordAudit({ tenantId: input.tenantId, companyId: input.companyId, actorUserId: input.actorUserId, action: "accounting.books.export", entityName: "fiscalYear", entityId: input.fiscalYearId, payload: { format: input.format, entries: data.journal.length } });
  return result;
}
