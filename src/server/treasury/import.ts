import ExcelJS from "exceljs";
import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { bankAccount, bankTransaction } from "@/db/schema";
import { planImport, planReferenceImport } from "@/lib/bank-import/dedupe";
import { looksLikeNorma43, matchesSpanishIban, parseNorma43, type Norma43Result } from "@/lib/bank-import/norma43";
import { applyMapping, decodeText, guessMapping, parseDelimited, validateMapping, type BankImportMapping } from "@/lib/bank-import/tabular";
import type { ImportedMovement, SkippedRow } from "@/lib/bank-import/types";
import { db } from "@/lib/db";
import { AccountingRuleError, isAccountingRuleError } from "@/server/accounting/errors";
import { recordAudit } from "@/server/audit";
import { assertFiscalPeriodOpen } from "@/server/fiscal/locks";
import type { TreasuryActor } from "@/server/treasury/bank-payments";
import { recordBankTransaction } from "@/server/treasury/service";
import { autoApplyRules } from "@/server/treasury/workbench";

/*
 * Asistente de importación de extractos: CSV de cualquier banco, Excel (.xlsx, y las "hojas"
 * HTML que algunos bancos descargan como .xls) y Norma 43 (AEB 43).
 */

export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

export type StatementFile = { name: string; bytes: Uint8Array };
export type StatementFormat = "CSV" | "XLSX" | "NORMA43";
export type StatementSource =
  | { format: "NORMA43"; norma43: Norma43Result }
  | { format: "CSV" | "XLSX"; table: string[][] };

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text).trim();
  }
  return String(value).trim();
}

async function readXlsx(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheet = workbook.worksheets.find((candidate) => candidate.actualRowCount > 1) ?? workbook.worksheets[0];
  if (!sheet) return [];
  const table: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    table[rowNumber - 1] = values.map((value) => cellText(value as ExcelJS.CellValue));
  });
  return Array.from(table, (row) => row ?? []);
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

/** Tabla HTML (bancos que exportan un "Excel" que en realidad es una página HTML). */
function readHtmlTable(text: string) {
  const rows: string[][] = [];
  for (const rowMatch of text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => decodeEntities(cell[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
    rows.push(cells);
  }
  return rows;
}

export async function readStatementFile(file: StatementFile): Promise<StatementSource> {
  if (file.bytes.byteLength === 0) throw new AccountingRuleError(422, "IMPORT_EMPTY", "El fichero está vacío.");
  if (file.bytes.byteLength > MAX_STATEMENT_BYTES) throw new AccountingRuleError(422, "IMPORT_TOO_BIG", "El fichero supera 5 MB. Descarga un periodo más corto.");
  const [b0, b1, b2, b3] = file.bytes;
  if (b0 === 0x50 && b1 === 0x4b) {
    try {
      return { format: "XLSX", table: await readXlsx(file.bytes) };
    } catch {
      throw new AccountingRuleError(422, "IMPORT_XLSX", "No se pudo leer el Excel. Ábrelo y guárdalo de nuevo como .xlsx o como CSV.");
    }
  }
  if (b0 === 0xd0 && b1 === 0xcf && b2 === 0x11 && b3 === 0xe0) {
    throw new AccountingRuleError(422, "IMPORT_XLS", "Es un Excel antiguo (.xls). Ábrelo en Excel o LibreOffice y guárdalo como .xlsx o CSV, o descarga el extracto en Norma 43.");
  }
  const text = decodeText(file.bytes);
  if (looksLikeNorma43(text)) return { format: "NORMA43", norma43: parseNorma43(text) };
  if (/<table[\s>]/i.test(text)) return { format: "XLSX", table: readHtmlTable(text) };
  return { format: "CSV", table: parseDelimited(text) };
}

async function loadImportAccount(companyId: string, bankAccountId: string) {
  const [account] = await db
    .select({ id: bankAccount.id, iban: bankAccount.iban, isActive: bankAccount.isActive, importMapping: bankAccount.importMapping })
    .from(bankAccount)
    .where(and(eq(bankAccount.id, bankAccountId), eq(bankAccount.companyId, companyId)))
    .limit(1);
  if (!account) throw new AccountingRuleError(404, "BANK_ACCOUNT_NOT_FOUND", "Cuenta bancaria no encontrada.");
  return account;
}

/** Un mapeo guardado solo se reutiliza si el fichero tiene las mismas columnas. */
function savedMappingFits(saved: BankImportMapping | null | undefined, table: string[][]) {
  if (!saved) return false;
  const headers = saved.headerRow >= 0 ? (table[saved.headerRow] ?? []).map((header) => header.trim()) : [];
  if (saved.headers && saved.headers.length > 0) return saved.headers.join("|") === headers.join("|");
  const columns = Math.max(0, ...table.slice(0, 20).map((row) => row.length));
  const used = [saved.dateColumn, saved.amountColumn, saved.debitColumn, saved.creditColumn, ...saved.descriptionColumns].filter((column): column is number => typeof column === "number");
  return used.every((column) => column < columns);
}

function selectNorma43Account(result: Norma43Result, iban: string, index?: number | null) {
  if (result.accounts.length === 0) throw new AccountingRuleError(422, "IMPORT_N43_EMPTY", "El fichero Norma 43 no contiene ninguna cuenta.");
  if (index !== null && index !== undefined) {
    const chosen = result.accounts[index];
    if (!chosen) throw new AccountingRuleError(422, "IMPORT_N43_ACCOUNT", "La cuenta elegida no está en el fichero.");
    return { account: chosen, index };
  }
  const matching = result.accounts.findIndex((account) => matchesSpanishIban(account, iban));
  if (matching >= 0) return { account: result.accounts[matching], index: matching };
  return { account: result.accounts[0], index: 0 };
}

function parseSource(source: StatementSource, iban: string, options: { mapping?: BankImportMapping | null; norma43AccountIndex?: number | null }) {
  if (source.format === "NORMA43") {
    const { account, index } = selectNorma43Account(source.norma43, iban, options.norma43AccountIndex);
    const warnings = [...source.norma43.warnings];
    if (!matchesSpanishIban(account, iban)) {
      warnings.push(`La cuenta del fichero (${account.bankCode} ${account.branchCode} ${account.accountNumber}) no coincide con el IBAN de la cuenta de destino. Comprueba que eliges el banco correcto.`);
    }
    return { movements: account.movements, skipped: source.norma43.skipped, warnings, mapping: null, norma43AccountIndex: index };
  }
  const mapping = options.mapping ?? guessMapping(source.table);
  const errors = validateMapping(mapping);
  if (errors.length > 0) return { movements: [] as ImportedMovement[], skipped: [] as SkippedRow[], warnings: errors, mapping, norma43AccountIndex: null, invalidMapping: true };
  const parsed = applyMapping(source.table, mapping);
  return { ...parsed, warnings: [] as string[], mapping, norma43AccountIndex: null };
}

/** Vista previa: filas del fichero, mapeo propuesto (o el recordado) y resultado de aplicarlo. */
export async function previewBankImport(companyId: string, input: { bankAccountId: string; file: StatementFile; mapping?: BankImportMapping | null; norma43AccountIndex?: number | null }) {
  const account = await loadImportAccount(companyId, input.bankAccountId);
  const source = await readStatementFile(input.file);
  const saved = source.format !== "NORMA43" && !input.mapping && savedMappingFits(account.importMapping, source.table) ? account.importMapping : null;
  const parsed = parseSource(source, account.iban, { mapping: input.mapping ?? saved, norma43AccountIndex: input.norma43AccountIndex });
  return {
    format: source.format,
    fileName: input.file.name,
    rows: source.format === "NORMA43" ? [] : source.table.slice(0, 30),
    columnCount: source.format === "NORMA43" ? 0 : Math.max(0, ...source.table.slice(0, 50).map((row) => row.length)),
    mapping: parsed.mapping,
    mappingSource: input.mapping ? "manual" : saved ? "saved" : "detected",
    norma43Accounts: source.format === "NORMA43"
      ? source.norma43.accounts.map((entry) => ({
          label: `${entry.bankCode} ${entry.branchCode} ${entry.accountNumber}${entry.holderName ? ` · ${entry.holderName}` : ""}`,
          movements: entry.movements.length,
          initialBalance: entry.initialBalance,
          finalBalance: entry.finalBalance,
          startDate: entry.startDate,
          endDate: entry.endDate,
          matchesAccount: matchesSpanishIban(entry, account.iban),
        }))
      : [],
    norma43AccountIndex: parsed.norma43AccountIndex,
    sample: parsed.movements.slice(0, 12),
    validCount: parsed.movements.length,
    skipped: parsed.skipped.slice(0, 100),
    skippedCount: parsed.skipped.length,
    warnings: parsed.warnings,
  };
}

export type ImportReport = {
  format: StatementFormat;
  imported: number;
  importedIds: string[];
  duplicates: SkippedRow[];
  skipped: SkippedRow[];
  warnings: string[];
  autoAssigned: number;
};

/** Guarda los movimientos (cada uno Banco ↔ 555), omite duplicados y aplica las reglas automáticas. */
export async function commitBankImport(
  actor: TreasuryActor,
  input: { bankAccountId: string; file: StatementFile; mapping?: BankImportMapping | null; saveMapping?: boolean; norma43AccountIndex?: number | null; applyRules?: boolean },
): Promise<ImportReport> {
  const account = await loadImportAccount(actor.companyId, input.bankAccountId);
  if (!account.isActive) throw new AccountingRuleError(409, "BANK_ACCOUNT_ARCHIVED", "La cuenta bancaria está archivada. Reactívala para importar movimientos.");
  const source = await readStatementFile(input.file);
  const parsed = parseSource(source, account.iban, { mapping: input.mapping, norma43AccountIndex: input.norma43AccountIndex });
  if ("invalidMapping" in parsed && parsed.invalidMapping) throw new AccountingRuleError(422, "IMPORT_MAPPING", parsed.warnings.join(" "));

  const importSource = source.format;
  const result = await importMovements(actor, account.id, parsed.movements, importSource);
  if (input.saveMapping && parsed.mapping && source.format !== "NORMA43") {
    await db.update(bankAccount).set({ importMapping: parsed.mapping }).where(and(eq(bankAccount.id, account.id), eq(bankAccount.companyId, actor.companyId)));
  }
  await recordAudit({
    tenantId: actor.tenantId,
    companyId: actor.companyId,
    actorUserId: actor.actorUserId,
    action: "treasury.import",
    entityName: "bankAccount",
    entityId: account.id,
    payload: { fileName: input.file.name, format: source.format, imported: result.importedIds.length, duplicates: result.duplicates.length, skipped: parsed.skipped.length + result.locked.length },
  });
  const auto = input.applyRules === false ? { applied: 0 } : await autoApplyRules(actor, result.importedIds);
  return {
    format: source.format,
    imported: result.importedIds.length,
    importedIds: result.importedIds,
    duplicates: result.duplicates,
    skipped: [...parsed.skipped, ...result.locked].sort((a, b) => a.line - b.line),
    warnings: parsed.warnings,
    autoAssigned: auto.applied,
  };
}

/**
 * Inserta movimientos ya leídos: deduplicación y periodos bloqueados por fila.
 * - Extractos (CSV/Excel/Norma 43): por fecha, importe, concepto y saldo (ver `planImport`).
 * - PSD2: por el identificador del banco guardado en `reference` (ver `planReferenceImport`).
 */
export async function importMovements(actor: Omit<TreasuryActor, "activeFiscalYearId">, bankAccountId: string, movements: ImportedMovement[], importSource: StatementFormat | "PSD2") {
  if (movements.length === 0) return { importedIds: [] as string[], duplicates: [] as SkippedRow[], locked: [] as SkippedRow[] };
  const times = movements.map((movement) => movement.postedAt.getTime());
  return db.transaction(async (tx) => {
    let plan: { toInsert: ImportedMovement[]; duplicates: SkippedRow[] };
    if (importSource === "PSD2") {
      const references = [...new Set(movements.map((movement) => movement.reference?.trim()).filter((value): value is string => Boolean(value)))];
      const existing = references.length
        ? await tx
          .select({ reference: bankTransaction.reference })
          .from(bankTransaction)
          .where(and(eq(bankTransaction.bankAccountId, bankAccountId), eq(bankTransaction.importSource, "PSD2"), inArray(bankTransaction.reference, references)))
        : [];
      plan = planReferenceImport(existing.map((row) => row.reference ?? ""), movements);
    } else {
      const existing = await tx
        .select({ postedAt: bankTransaction.postedAt, amount: bankTransaction.amount, description: bankTransaction.description, balanceAfter: bankTransaction.balanceAfter })
        .from(bankTransaction)
        .where(and(
          eq(bankTransaction.bankAccountId, bankAccountId),
          gte(bankTransaction.postedAt, new Date(Math.min(...times))),
          lte(bankTransaction.postedAt, new Date(Math.max(...times))),
        ));
      plan = planImport(existing, movements);
    }
    const importedIds: string[] = [];
    const locked: SkippedRow[] = [];
    const lockByDay = new Map<number, string | null>();
    for (const movement of plan.toInsert) {
      const day = movement.postedAt.getTime();
      if (!lockByDay.has(day)) {
        try {
          await assertFiscalPeriodOpen(actor.companyId, movement.postedAt, tx);
          lockByDay.set(day, null);
        } catch (error) {
          if (!isAccountingRuleError(error)) throw error;
          lockByDay.set(day, error.message);
        }
      }
      const lockReason = lockByDay.get(day);
      if (lockReason) {
        locked.push({ line: movement.line, reason: lockReason });
        continue;
      }
      const created = await recordBankTransaction(actor.companyId, actor.tenantId, actor.actorUserId, {
        bankAccountId,
        postedAt: movement.postedAt,
        amount: movement.amount.toFixed(2),
        description: movement.description,
        valueDate: movement.valueDate,
        balanceAfter: movement.balanceAfter === null ? null : movement.balanceAfter.toFixed(2),
        reference: movement.reference?.slice(0, 200) ?? null,
        importSource,
      }, tx);
      importedIds.push(created.id);
    }
    return { importedIds, duplicates: plan.duplicates, locked };
  });
}
