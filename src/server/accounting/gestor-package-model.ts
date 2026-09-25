import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";

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
  workbook.creator = "ERP Suite";
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

export async function buildVatRegisterWorkbook(data: GestorPackageData, kind: "issued" | "received") {
  const title = kind === "issued" ? "Libro registro de facturas expedidas" : "Libro registro de facturas recibidas";
  const workbook = newWorkbook(data, title);
  const sheet = sheetWithHeader(workbook, kind === "issued" ? "Expedidas" : "Recibidas", [
    { header: "Fecha de expedición", key: "date", width: 14, style: { numFmt: DATE_FORMAT } },
    { header: kind === "issued" ? "Número" : "Número de registro", key: "number", width: 16 },
    ...(kind === "received" ? [{ header: "Número de factura del proveedor", key: "supplierNumber", width: 22 }] : []),
    { header: kind === "issued" ? "Cliente" : "Proveedor", key: "name", width: 36 },
    { header: "NIF", key: "taxId", width: 14 },
    { header: "Tipo de operación", key: "treatment", width: 24 },
    { header: "Base imponible", key: "base", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: kind === "issued" ? "IVA repercutido" : "IVA soportado", key: "tax", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Retención IRPF", key: "withholding", width: 16, style: { numFmt: MONEY_FORMAT } },
    { header: "Total factura", key: "total", width: 16, style: { numFmt: MONEY_FORMAT } },
  ]);
  const rows = kind === "issued" ? data.vatIssued : data.vatReceived;
  const totals = { base: 0, tax: 0, withholding: 0, total: 0 };
  for (const row of rows) {
    sheet.addRow({
      date: new Date(row.issueDate),
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
    totals.tax += row.taxAmount;
    totals.withholding += row.withholdingAmount;
    totals.total += row.totalAmount;
  }
  const total = sheet.addRow({ name: "Total", base: round2(totals.base), tax: round2(totals.tax), withholding: round2(totals.withholding), total: round2(totals.total) });
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
    `- ${GESTOR_PACKAGE_FILES.vatReceived}: ${data.vatReceived.length} facturas recibidas.`,
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
