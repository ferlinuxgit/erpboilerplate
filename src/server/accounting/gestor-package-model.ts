import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";

import { isSelfAssessedTreatment, type SupplierVatTreatment } from "@/lib/fiscal-spain";
import { applyPct, centsToNumber, toCents } from "@/server/accounting/money";
import type { TrialBalanceRow } from "@/server/accounting/statements-model";
import type { VatRegisterRow } from "@/server/fiscal/spain";

/**
 * "Paquete para el gestor" (sin base de datos): a partir de los datos del periodo genera los
 * libros en Excel y los junta en un ZIP con los PDF de los modelos.
 */

export type GestorJournalLine = {
  entryId: string;
  number: string;
  postedAt: Date;
  reference: string | null;
  origin: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
};

export type GestorPackageData = {
  companyName: string;
  companyTaxId: string | null;
  periodLabel: string;
  from: Date;
  /** Último día incluido. */
  to: Date;
  journal: GestorJournalLine[];
  /** Saldo inicial por cuenta (debe − haber antes de `from`, sin cierre/apertura). */
  openingBalances: Map<string, number>;
  trialBalance: TrialBalanceRow[];
  vatIssued: VatRegisterRow[];
  vatReceived: VatRegisterRow[];
  /**
   * Libro registro de recibidas con el detalle del art. 64 RIVA: una fila por factura y tipo
   * impositivo. Si falta, el libro se genera con una fila por factura (`vatReceived`).
   */
  vatReceivedDetail?: ReceivedRegisterRow[];
  modelPdfs: Array<{ fileName: string; bytes: Uint8Array }>;
  generatedAt: Date;
};

export const GESTOR_PACKAGE_FILES = {
  journal: "libro-diario.xlsx",
  ledger: "libro-mayor.xlsx",
  trialBalance: "sumas-y-saldos.xlsx",
  vatIssued: "libro-registro-iva-expedidas.xlsx",
  vatReceived: "libro-registro-iva-recibidas.xlsx",
  readme: "LEEME.txt",
} as const;

const MONEY_FORMAT = '#,##0.00;-#,##0.00';
const DATE_FORMAT = "dd/mm/yyyy";

const vatTreatmentLabels: Record<string, string> = {
  DOMESTIC: "Nacional",
  INTRA_EU: "Entrega intracomunitaria",
  INTRA_EU_SERVICES: "Servicios intracomunitarios",
  EXPORT: "Exportación",
  EXEMPT: "Exenta",
  REVERSE_CHARGE: "Inversión del sujeto pasivo",
  NOT_SUBJECT: "No sujeta",
  IMPORT: "Importación",
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Línea de factura recibida con los datos de su cabecera, tal como sale de la base de datos. */
export type ReceivedRegisterLine = {
  invoiceId: string;
  number: string;
  supplierNumber: string | null;
  supplierName: string;
  supplierTaxId: string | null;
  issueDate: Date;
  /** Fecha de registro (periodo de deducción). En la fila de anulación, la fecha de la anulación. */
  registrationDate: Date;
  operationDate: Date | null;
  /** INVOICE o RECTIFICATION. */
  documentKind: string;
  rectifiedDocumentNumber: string | null;
  rectifiedIssueDate: Date | null;
  vatTreatment: string;
  isSimplified: boolean;
  importDuaNumber: string | null;
  importDuaDate: Date | null;
  totalAmount: number | string;
  /** Prorrata guardada en la factura (0-100). */
  prorrataPct: number | string;
  base: number | string;
  taxRate: number | string;
  taxAmount: number | string;
  taxDeductiblePct: number | string;
  surchargeRate: number | string;
  surchargeAmount: number | string;
  retentionAmount: number | string;
  isInvestmentGood: boolean;
  /** −1 en la fila de anulación de una factura (resta en el periodo de la anulación). */
  sign?: 1 | -1;
};

/** Fila del libro registro de facturas recibidas: una por factura y tipo impositivo. */
export type ReceivedRegisterRow = {
  invoiceId: string;
  issueDate: Date;
  operationDate: Date | null;
  registrationDate: Date;
  number: string;
  supplierNumber: string | null;
  /** "Factura", "Rectificativa", "Factura simplificada"… (con «(anulación)» en la fila de anulación). */
  documentClass: string;
  documentKind: string;
  /** Número (y fecha) de la factura rectificada. */
  rectifiedInvoice: string;
  supplierName: string;
  supplierTaxId: string | null;
  vatTreatment: string;
  taxRate: number;
  base: number;
  /** Cuota repercutida por el proveedor (0 en autorepercusión). */
  chargedTax: number;
  /** Cuota autorrepercutida (intracomunitarias e inversión del sujeto pasivo). */
  selfAssessedTax: number;
  /** Cuota deducible: cuota × % deducible de cada línea × prorrata. */
  deductibleTax: number;
  surchargeRate: number;
  surchargeAmount: number;
  withholding: number;
  /** "Sí", "Parcial" o "" según las líneas del tipo sean bienes de inversión. */
  investmentGood: string;
  /** Número y fecha del DUA (importaciones). */
  importDua: string;
  /** Total de la factura: solo en la primera fila de cada factura (no se duplica al sumar). */
  totalAmount: number | null;
};

const registerDate = (date: Date) => `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;

/**
 * Agrupa las líneas de las facturas recibidas en filas del libro registro: una por factura y tipo
 * impositivo (y tipo de recargo), en céntimos enteros y con el mismo criterio que el modelo 303:
 * - autorepercusión: el proveedor no repercute cuota; la que figura es la que declara la empresa
 *   (la de la línea o, sin tipo, la del tipo general);
 * - cuota deducible = cuota × % deducible de la línea × prorrata de la factura;
 * - una rectificativa conserva su signo (abono en negativo) y la anulación de una factura sale
 *   como fila aparte con los importes cambiados de signo.
 */
export function buildReceivedRegisterRows(lines: readonly ReceivedRegisterLine[], options: { selfAssessmentRate?: number } = {}): ReceivedRegisterRow[] {
  const selfAssessmentRate = options.selfAssessmentRate ?? 21;
  type Group = { row: ReceivedRegisterRow; cents: { base: number; charged: number; selfAssessed: number; deductible: number; surcharge: number; withholding: number }; investment: number; lineCount: number };
  const groups = new Map<string, Group>();
  const firstRowOfInvoice = new Set<string>();

  for (const line of lines) {
    const sign = line.sign ?? 1;
    const selfAssessedLine = isSelfAssessedTreatment(line.vatTreatment as SupplierVatTreatment);
    const baseCents = sign * toCents(line.base);
    const lineTaxCents = toCents(line.taxAmount);
    const vatCents = sign * (selfAssessedLine && lineTaxCents === 0 ? toCents((Number(line.base) * selfAssessmentRate) / 100) : lineTaxCents);
    const taxRate = selfAssessedLine && lineTaxCents === 0 ? selfAssessmentRate : Number(line.taxRate);
    const surchargeRate = Number(line.surchargeRate) || 0;
    const effectivePct = (Math.min(Math.max(Number(line.taxDeductiblePct), 0), 100) * Math.min(Math.max(Number(line.prorrataPct), 0), 100)) / 100;
    const documentKey = `${line.invoiceId}|${sign}`;
    const key = `${documentKey}|${taxRate}|${surchargeRate}`;

    let group = groups.get(key);
    if (!group) {
      const isFirst = !firstRowOfInvoice.has(documentKey);
      firstRowOfInvoice.add(documentKey);
      const baseClass = line.documentKind === "RECTIFICATION" ? "Rectificativa" : line.isSimplified ? "Factura simplificada" : "Factura";
      group = {
        row: {
          invoiceId: line.invoiceId,
          issueDate: line.issueDate,
          operationDate: line.operationDate,
          registrationDate: line.registrationDate,
          number: sign === 1 ? line.number : `${line.number} (anulación)`,
          supplierNumber: line.supplierNumber,
          documentClass: sign === 1 ? baseClass : `${baseClass} (anulación)`,
          documentKind: line.documentKind,
          rectifiedInvoice: line.documentKind === "RECTIFICATION"
            ? [line.rectifiedDocumentNumber, line.rectifiedIssueDate ? `(${registerDate(line.rectifiedIssueDate)})` : null].filter(Boolean).join(" ")
            : "",
          supplierName: line.supplierName,
          supplierTaxId: line.supplierTaxId,
          vatTreatment: line.vatTreatment,
          taxRate,
          base: 0,
          chargedTax: 0,
          selfAssessedTax: 0,
          deductibleTax: 0,
          surchargeRate,
          surchargeAmount: 0,
          withholding: 0,
          investmentGood: "",
          importDua: [line.importDuaNumber, line.importDuaDate ? `(${registerDate(line.importDuaDate)})` : null].filter(Boolean).join(" "),
          totalAmount: isFirst ? centsToNumber(sign * toCents(line.totalAmount)) : null,
        },
        cents: { base: 0, charged: 0, selfAssessed: 0, deductible: 0, surcharge: 0, withholding: 0 },
        investment: 0,
        lineCount: 0,
      };
      groups.set(key, group);
    }
    group.cents.base += baseCents;
    if (selfAssessedLine) group.cents.selfAssessed += vatCents;
    else group.cents.charged += vatCents;
    group.cents.deductible += applyPct(vatCents, effectivePct);
    group.cents.surcharge += sign * toCents(line.surchargeAmount);
    group.cents.withholding += sign * toCents(line.retentionAmount);
    group.lineCount += 1;
    if (line.isInvestmentGood) group.investment += 1;
  }

  return [...groups.values()]
    .map(({ row, cents, investment, lineCount }) => ({
      ...row,
      base: centsToNumber(cents.base),
      chargedTax: centsToNumber(cents.charged),
      selfAssessedTax: centsToNumber(cents.selfAssessed),
      deductibleTax: centsToNumber(cents.deductible),
      surchargeAmount: centsToNumber(cents.surcharge),
      withholding: centsToNumber(cents.withholding),
      investmentGood: investment === 0 ? "" : investment === lineCount ? "Sí" : "Parcial",
    }))
    // Orden estable: fecha de registro, número y tipo. El total de la factura va en su primera fila.
    .sort((left, right) =>
      left.registrationDate.getTime() - right.registrationDate.getTime()
      || left.number.localeCompare(right.number)
      || Number(right.totalAmount !== null) - Number(left.totalAmount !== null)
      || left.taxRate - right.taxRate);
}

/** Hoja con cabecera en negrita, fija y con autofiltro (el gestor suele filtrar por cuenta o fecha). */
function sheetWithHeader(workbook: ExcelJS.Workbook, name: string, columns: Array<Partial<ExcelJS.Column>>) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

function newWorkbook(data: GestorPackageData, title: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Norpie";
  workbook.created = data.generatedAt;
  workbook.subject = `${title} · ${data.companyName} · ${data.periodLabel}`;
  return workbook;
}

async function toBytes(workbook: ExcelJS.Workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function buildJournalWorkbook(data: GestorPackageData) {
  const workbook = newWorkbook(data, "Libro diario");
  const sheet = sheetWithHeader(workbook, "Libro diario", [
    { header: "Fecha", key: "date", width: 12, style: { numFmt: DATE_FORMAT } },
    { header: "Asiento", key: "number", width: 14 },
    { header: "Concepto", key: "reference", width: 42 },
    { header: "Origen", key: "origin", width: 22 },
    { header: "Cuenta", key: "account", width: 12 },
    { header: "Nombre de la cuenta", key: "accountName", width: 36 },
    { header: "Debe", key: "debit", width: 14, style: { numFmt: MONEY_FORMAT } },
    { header: "Haber", key: "credit", width: 14, style: { numFmt: MONEY_FORMAT } },
  ]);
  let debit = 0;
  let credit = 0;
  for (const line of data.journal) {
    sheet.addRow({
      date: line.postedAt,
      number: line.number,
      reference: line.reference ?? "",
      origin: line.origin,
      account: line.accountCode,
      accountName: line.accountName,
      debit: line.debit || null,
      credit: line.credit || null,
    });
    debit += line.debit;
    credit += line.credit;
  }
  const total = sheet.addRow({ reference: "Total del periodo", debit: round2(debit), credit: round2(credit) });
  total.font = { bold: true };
  return toBytes(workbook);
}

export async function buildLedgerWorkbook(data: GestorPackageData) {
  const workbook = newWorkbook(data, "Libro mayor");
  const sheet = sheetWithHeader(workbook, "Libro mayor", [
    { header: "Cuenta", key: "account", width: 12 },
    { header: "Nombre de la cuenta", key: "accountName", width: 36 },
    { header: "Fecha", key: "date", width: 12, style: { numFmt: DATE_FORMAT } },
    { header: "Asiento", key: "number", width: 14 },
    { header: "Concepto", key: "reference", width: 42 },
    { header: "Debe", key: "debit", width: 14, style: { numFmt: MONEY_FORMAT } },
    { header: "Haber", key: "credit", width: 14, style: { numFmt: MONEY_FORMAT } },
    { header: "Saldo (deudor +, acreedor −)", key: "balance", width: 22, style: { numFmt: MONEY_FORMAT } },
  ]);

  const byAccount = new Map<string, GestorJournalLine[]>();
  for (const line of data.journal) byAccount.set(line.accountCode, [...(byAccount.get(line.accountCode) ?? []), line]);
  const names = new Map(data.journal.map((line) => [line.accountCode, line.accountName]));
  for (const row of data.trialBalance) names.set(row.code, row.name);
  const codes = [...new Set([...byAccount.keys(), ...[...data.openingBalances.entries()].filter(([, value]) => value !== 0).map(([code]) => code)])].sort();

  for (const code of codes) {
    let balance = data.openingBalances.get(code) ?? 0;
    const opening = sheet.addRow({ account: code, accountName: names.get(code) ?? "", date: data.from, reference: "Saldo anterior", balance: round2(balance) });
    opening.font = { italic: true };
    const lines = [...(byAccount.get(code) ?? [])].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime() || a.number.localeCompare(b.number));
    for (const line of lines) {
      balance += line.debit - line.credit;
      sheet.addRow({
        account: code,
        accountName: line.accountName,
        date: line.postedAt,
        number: line.number,
        reference: line.reference ?? "",
        debit: line.debit || null,
        credit: line.credit || null,
        balance: round2(balance),
      });
    }
  }
  return toBytes(workbook);
}

export async function buildTrialBalanceWorkbook(data: GestorPackageData) {
  const workbook = newWorkbook(data, "Balance de sumas y saldos");
  const sheet = sheetWithHeader(workbook, "Sumas y saldos", [
    { header: "Cuenta", key: "account", width: 12 },
    { header: "Nombre de la cuenta", key: "accountName", width: 40 },
    { header: "Saldo inicial", key: "opening", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Debe", key: "debit", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Haber", key: "credit", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Saldo deudor", key: "debitBalance", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Saldo acreedor", key: "creditBalance", width: 16, style: { numFmt: MONEY_FORMAT } },
  ]);
  let debit = 0;
  let credit = 0;
  for (const row of data.trialBalance) {
    sheet.addRow({
      account: row.code,
      accountName: row.name,
      opening: row.opening,
      debit: row.debit,
      credit: row.credit,
      debitBalance: row.closing > 0 ? row.closing : null,
      creditBalance: row.closing < 0 ? -row.closing : null,
    });
    debit += row.debit;
    credit += row.credit;
  }
  const total = sheet.addRow({ accountName: "Total", debit: round2(debit), credit: round2(credit) });
  total.font = { bold: true };
  return toBytes(workbook);
}

/** Libro registro de facturas recibidas con una fila por factura y tipo impositivo (art. 64 RIVA). */
async function buildReceivedRegisterWorkbook(data: GestorPackageData, rows: readonly ReceivedRegisterRow[]) {
  const workbook = newWorkbook(data, "Libro registro de facturas recibidas");
  const PERCENT_FORMAT = "0.##";
  const sheet = sheetWithHeader(workbook, "Recibidas", [
    { header: "Fecha de expedición", key: "date", width: 14, style: { numFmt: DATE_FORMAT } },
    { header: "Fecha de operación", key: "operationDate", width: 14, style: { numFmt: DATE_FORMAT } },
    { header: "Fecha de registro", key: "registrationDate", width: 14, style: { numFmt: DATE_FORMAT } },
    { header: "Número de registro", key: "number", width: 18 },
    { header: "Número de factura del proveedor", key: "supplierNumber", width: 22 },
    { header: "Clase", key: "documentClass", width: 20 },
    { header: "Factura rectificada", key: "rectifiedInvoice", width: 24 },
    { header: "Proveedor", key: "name", width: 36 },
    { header: "NIF", key: "taxId", width: 14 },
    { header: "Tipo de operación", key: "treatment", width: 24 },
    { header: "Tipo IVA (%)", key: "rate", width: 11, style: { numFmt: PERCENT_FORMAT } },
    { header: "Base imponible", key: "base", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Cuota soportada", key: "charged", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "IVA autorrepercutido", key: "selfAssessed", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Cuota deducible", key: "tax", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Tipo recargo (%)", key: "surchargeRate", width: 12, style: { numFmt: PERCENT_FORMAT } },
    { header: "Recargo de equivalencia", key: "surcharge", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Bien de inversión", key: "investment", width: 12 },
    { header: "DUA (importación)", key: "dua", width: 26 },
    { header: "Retención IRPF", key: "withholding", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Total factura", key: "total", width: 16, style: { numFmt: MONEY_FORMAT } },
  ]);
  const totals = { base: 0, charged: 0, selfAssessed: 0, tax: 0, surcharge: 0, withholding: 0, total: 0 };
  for (const row of rows) {
    sheet.addRow({
      date: row.issueDate,
      operationDate: row.operationDate,
      registrationDate: row.registrationDate,
      number: row.number,
      supplierNumber: row.supplierNumber ?? "",
      documentClass: row.documentClass,
      rectifiedInvoice: row.rectifiedInvoice,
      name: row.supplierName,
      taxId: row.supplierTaxId ?? "",
      treatment: vatTreatmentLabels[row.vatTreatment] ?? row.vatTreatment,
      rate: row.taxRate,
      base: row.base,
      charged: row.chargedTax,
      selfAssessed: row.selfAssessedTax || null,
      tax: row.deductibleTax,
      surchargeRate: row.surchargeRate || null,
      surcharge: row.surchargeAmount || null,
      investment: row.investmentGood,
      dua: row.importDua,
      withholding: row.withholding || null,
      total: row.totalAmount,
    });
    totals.base += toCents(row.base);
    totals.charged += toCents(row.chargedTax);
    totals.selfAssessed += toCents(row.selfAssessedTax);
    totals.tax += toCents(row.deductibleTax);
    totals.surcharge += toCents(row.surchargeAmount);
    totals.withholding += toCents(row.withholding);
    totals.total += toCents(row.totalAmount ?? 0);
  }
  const total = sheet.addRow({
    name: "Total",
    base: centsToNumber(totals.base),
    charged: centsToNumber(totals.charged),
    selfAssessed: centsToNumber(totals.selfAssessed),
    tax: centsToNumber(totals.tax),
    surcharge: centsToNumber(totals.surcharge),
    withholding: centsToNumber(totals.withholding),
    total: centsToNumber(totals.total),
  });
  total.font = { bold: true };
  return toBytes(workbook);
}

export async function buildVatRegisterWorkbook(data: GestorPackageData, kind: "issued" | "received") {
  if (kind === "received" && data.vatReceivedDetail) return buildReceivedRegisterWorkbook(data, data.vatReceivedDetail);
  const title = kind === "issued" ? "Libro registro de facturas expedidas" : "Libro registro de facturas recibidas";
  const workbook = newWorkbook(data, title);
  const sheet = sheetWithHeader(workbook, kind === "issued" ? "Expedidas" : "Recibidas", [
    { header: "Fecha de expedición", key: "date", width: 14, style: { numFmt: DATE_FORMAT } },
    ...(kind === "received" ? [{ header: "Fecha de registro", key: "registrationDate", width: 14, style: { numFmt: DATE_FORMAT } }] : []),
    { header: kind === "issued" ? "Número" : "Número de registro", key: "number", width: 16 },
    ...(kind === "received" ? [{ header: "Número de factura del proveedor", key: "supplierNumber", width: 22 }] : []),
    { header: kind === "issued" ? "Cliente" : "Proveedor", key: "name", width: 36 },
    { header: "NIF", key: "taxId", width: 14 },
    { header: "Tipo de operación", key: "treatment", width: 24 },
    { header: "Base imponible", key: "base", width: 16, style: { numFmt: MONEY_FORMAT } },
    ...(kind === "received" ? [
      { header: "Cuota soportada", key: "charged", width: 16, style: { numFmt: MONEY_FORMAT } },
      { header: "IVA autorrepercutido", key: "selfAssessed", width: 16, style: { numFmt: MONEY_FORMAT } },
    ] : []),
    { header: kind === "issued" ? "IVA repercutido" : "IVA deducible", key: "tax", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Retención IRPF", key: "withholding", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Total factura", key: "total", width: 16, style: { numFmt: MONEY_FORMAT } },
  ]);
  const rows = kind === "issued" ? data.vatIssued : data.vatReceived;
  const totals = { base: 0, charged: 0, selfAssessed: 0, tax: 0, withholding: 0, total: 0 };
  for (const row of rows) {
    // Intracomunitaria / ISP: el proveedor no cobra IVA; la cuota la declara la empresa (devengado).
    const quota = row.chargedTaxAmount ?? row.taxAmount;
    const selfAssessed = kind === "received" && Boolean(row.vatTreatment) && isSelfAssessedTreatment(row.vatTreatment as SupplierVatTreatment);
    const charged = selfAssessed ? 0 : quota;
    sheet.addRow({
      date: new Date(row.issueDate),
      registrationDate: new Date(row.registrationDate ?? row.issueDate),
      charged,
      selfAssessed: selfAssessed ? quota : null,
      number: row.number,
      supplierNumber: row.supplierNumber ?? "",
      name: row.counterpartyName,
      taxId: row.counterpartyTaxId ?? "",
      treatment: vatTreatmentLabels[row.vatTreatment ?? "DOMESTIC"] ?? row.vatTreatment ?? "",
      base: row.taxBase,
      tax: row.taxAmount,
      withholding: row.withholdingAmount || null,
      total: row.totalAmount,
    });
    totals.base += row.taxBase;
    totals.charged += charged;
    if (selfAssessed) totals.selfAssessed += quota;
    totals.tax += row.taxAmount;
    totals.withholding += row.withholdingAmount;
    totals.total += row.totalAmount;
  }
  const total = sheet.addRow({ name: "Total", base: round2(totals.base), charged: round2(totals.charged), selfAssessed: round2(totals.selfAssessed), tax: round2(totals.tax), withholding: round2(totals.withholding), total: round2(totals.total) });
  total.font = { bold: true };
  return toBytes(workbook);
}

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export function buildReadme(data: GestorPackageData) {
  const lines = [
    `Paquete para el gestor · ${data.companyName}${data.companyTaxId ? ` (${data.companyTaxId})` : ""}`,
    `Periodo: ${data.periodLabel} (del ${dateKey(data.from)} al ${dateKey(data.to)})`,
    `Generado: ${data.generatedAt.toISOString()}`,
    "",
    "Contenido:",
    `- ${GESTOR_PACKAGE_FILES.journal}: todos los asientos del periodo con sus líneas (${data.journal.length} líneas).`,
    `- ${GESTOR_PACKAGE_FILES.ledger}: movimientos por cuenta con saldo anterior y saldo acumulado.`,
    `- ${GESTOR_PACKAGE_FILES.trialBalance}: saldo inicial, debe, haber y saldo final por cuenta (sin asientos de regularización, cierre ni apertura).`,
    `- ${GESTOR_PACKAGE_FILES.vatIssued}: ${data.vatIssued.length} facturas expedidas.`,
    `- ${GESTOR_PACKAGE_FILES.vatReceived}: ${data.vatReceived.length} facturas recibidas${data.vatReceivedDetail ? ", una fila por factura y tipo impositivo (las rectificativas, con su signo y la factura que rectifican)" : ""}.`,
    data.modelPdfs.length
      ? `- modelos/: ${data.modelPdfs.map((pdf) => pdf.fileName).join(", ")}.`
      : "- modelos/: no hay modelos fiscales preparados para este periodo.",
    "",
    "Importes en euros. Las cantidades del libro registro coinciden con las del modelo 303 del mismo periodo.",
  ];
  return lines.join("\r\n");
}

/** Genera el ZIP completo. Devuelve el contenido y la lista de ficheros (para auditoría). */
export async function buildGestorPackageZip(data: GestorPackageData) {
  const [journal, ledger, trialBalance, vatIssued, vatReceived] = await Promise.all([
    buildJournalWorkbook(data),
    buildLedgerWorkbook(data),
    buildTrialBalanceWorkbook(data),
    buildVatRegisterWorkbook(data, "issued"),
    buildVatRegisterWorkbook(data, "received"),
  ]);
  const files: Record<string, Uint8Array> = {
    [GESTOR_PACKAGE_FILES.readme]: strToU8(buildReadme(data)),
    [GESTOR_PACKAGE_FILES.journal]: journal,
    [GESTOR_PACKAGE_FILES.ledger]: ledger,
    [GESTOR_PACKAGE_FILES.trialBalance]: trialBalance,
    [GESTOR_PACKAGE_FILES.vatIssued]: vatIssued,
    [GESTOR_PACKAGE_FILES.vatReceived]: vatReceived,
  };
  for (const pdf of data.modelPdfs) files[`modelos/${pdf.fileName}`] = pdf.bytes;
  // Los .xlsx y .pdf ya van comprimidos: nivel bajo para no gastar CPU.
  return { bytes: zipSync(files, { level: 1, mtime: data.generatedAt }), fileNames: Object.keys(files) };
}

/** Nombre del ZIP: paquete-gestor-<empresa>-<periodo>.zip, sin caracteres problemáticos. */
export function gestorPackageFileName(companyName: string, periodLabel: string) {
  const slug = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  return `paquete-gestor-${slug(companyName) || "empresa"}-${slug(periodLabel) || "periodo"}.zip`;
}
