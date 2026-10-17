import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";

import { isSelfAssessedTreatment, type SupplierVatTreatment } from "@/lib/fiscal-spain";

/**
 * Exportación de facturas de proveedor para el asesor (sin base de datos).
 *
 * - Hoja "Facturas": una fila por factura con los datos que pide el asesor para contabilizar o
 *   revisar (registro, fechas, proveedor, NIF, tipo de operación, base, IVA, IVA deducible,
 *   retención, total, pagos y documento). En adquisiciones intracomunitarias e inversión del sujeto
 *   pasivo el proveedor no cobra IVA: "Cuota IVA" va a 0 (base + cuota − retención = total) y la cuota
 *   que declara la empresa sale en "IVA autorrepercutido" (devengado en el 303; el deducible, aparte).
 * - Hoja "Desglose IVA": una fila por factura, tipo de IVA y cuenta de gasto (lo necesario para el
 *   303 y el libro registro cuando una factura tiene varios tipos).
 * - Con documentos: un ZIP con el Excel y `facturas/<registro>_<proveedor>_<nº proveedor>.<ext>`,
 *   enlazados desde la columna "Documento" con rutas relativas (funcionan al descomprimir).
 */

export type ExpenseExportLine = {
  accountCode: string | null;
  accountName: string | null;
  base: number;
  taxRate: number;
  taxAmount: number;
  taxDeductiblePct: number;
  retentionRate: number;
  retentionAmount: number;
};

export type ExpenseExportDocument = {
  fileName: string;
  contentType: string | null;
  /** Se carga solo si se piden los documentos. */
  load: () => Promise<Uint8Array>;
};

export type ExpenseExportInvoice = {
  id: string;
  number: string;
  issueDate: Date;
  /** Fecha de registro (periodo de IVA). */
  accountingDate: Date;
  dueDate: Date | null;
  supplierDocumentNumber: string | null;
  supplierName: string;
  supplierTaxId: string | null;
  supplierCountryCode: string | null;
  vatTreatment: string | null;
  currencyCode: string;
  subtotalAmount: number;
  taxAmount: number;
  retentionAmount: number;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: string;
  purchaseOrderNumber: string | null;
  notes: string | null;
  /** Porcentaje de prorrata aplicado al contabilizar (100 si no hay prorrata). */
  prorrataPct: number;
  lines: ExpenseExportLine[];
  documents: ExpenseExportDocument[];
};

export type ExpenseExportData = {
  companyName: string;
  companyTaxId: string | null;
  /** Texto del periodo o filtro aplicado ("1T 2026", "Del 01/01/2026 al 31/03/2026"…). */
  periodLabel: string;
  generatedAt: Date;
  invoices: ExpenseExportInvoice[];
};

const MONEY_FORMAT = "#,##0.00;-#,##0.00";
const PERCENT_FORMAT = "0.##";
const DATE_FORMAT = "dd/mm/yyyy";

export const purchaseVatTreatmentLabels: Record<string, string> = {
  DOMESTIC: "Interior",
  INTRA_EU: "Adquisición intracomunitaria",
  REVERSE_CHARGE: "Inversión del sujeto pasivo",
  IMPORT: "Importación",
  NOT_SUBJECT: "No sujeta",
};

const paymentStatusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  PARTIAL: "Pago parcial",
  PAID: "Pagada",
  OVERDUE: "Vencida",
  VOID: "Anulada",
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function slug(value: string, max: number) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

function extensionFor(document: Pick<ExpenseExportDocument, "fileName" | "contentType">) {
  const fromName = /\.([A-Za-z0-9]{2,5})$/.exec(document.fileName)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (document.contentType === "application/pdf") return "pdf";
  if (document.contentType === "image/png") return "png";
  if (document.contentType === "image/jpeg") return "jpg";
  if (document.contentType === "image/webp") return "webp";
  return "bin";
}

/**
 * Nombre del documento dentro del ZIP: el número de registro primero (ordena igual que el Excel),
 * luego proveedor y número de factura del proveedor. Varios documentos de la misma factura llevan
 * sufijo -2, -3…
 */
export function expenseDocumentFileName(invoice: Pick<ExpenseExportInvoice, "number" | "supplierName" | "supplierDocumentNumber">, document: Pick<ExpenseExportDocument, "fileName" | "contentType">, index = 0) {
  const parts = [slug(invoice.number, 30) || "factura", slug(invoice.supplierName, 40), slug(invoice.supplierDocumentNumber ?? "", 30)].filter(Boolean);
  return `facturas/${parts.join("_")}${index > 0 ? `-${index + 1}` : ""}.${extensionFor(document)}`;
}

/** IVA deducible de la factura: cuota × % deducible de cada línea × prorrata. */
export function deductibleTaxAmount(invoice: Pick<ExpenseExportInvoice, "lines" | "prorrataPct">) {
  const cents = invoice.lines.reduce(
    (total, line) => total + Math.round(line.taxAmount * 100 * (line.taxDeductiblePct / 100) * (invoice.prorrataPct / 100)),
    0,
  );
  return cents / 100;
}

/** El IVA de la factura lo declara la empresa (autorepercusión), no lo cobra el proveedor. */
function selfAssessed(invoice: Pick<ExpenseExportInvoice, "vatTreatment">) {
  return Boolean(invoice.vatTreatment) && isSelfAssessedTreatment(invoice.vatTreatment as SupplierVatTreatment);
}

/** Cuota cobrada por el proveedor y cuota autorrepercutida (una de las dos es 0). */
function taxColumns(invoice: Pick<ExpenseExportInvoice, "vatTreatment">, taxAmount: number) {
  return selfAssessed(invoice) ? { tax: 0, selfAssessedTax: taxAmount } : { tax: taxAmount, selfAssessedTax: 0 };
}

function sheetWithHeader(workbook: ExcelJS.Workbook, name: string, columns: Array<Partial<ExcelJS.Column>>) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return sheet;
}

function distinct(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function buildExpenseExportWorkbook(data: ExpenseExportData, options: { documentPaths?: Map<string, string[]> } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ERP Suite";
  workbook.created = data.generatedAt;
  workbook.subject = `Facturas recibidas · ${data.companyName} · ${data.periodLabel}`;

  const invoicesSheet = sheetWithHeader(workbook, "Facturas", [
    { header: "Nº registro", key: "number", width: 16 },
    { header: "Fecha factura", key: "issueDate", width: 13, style: { numFmt: DATE_FORMAT } },
    { header: "Fecha de registro", key: "accountingDate", width: 13, style: { numFmt: DATE_FORMAT } },
    { header: "Nº factura proveedor", key: "supplierNumber", width: 20 },
    { header: "Proveedor", key: "supplier", width: 34 },
    { header: "NIF", key: "taxId", width: 14 },
    { header: "País", key: "country", width: 6 },
    { header: "Tipo de operación", key: "treatment", width: 26 },
    { header: "Cuenta de gasto", key: "accounts", width: 22 },
    { header: "Tipos de IVA (%)", key: "rates", width: 14 },
    { header: "Base imponible", key: "base", width: 15, style: { numFmt: MONEY_FORMAT } },
    { header: "Cuota IVA", key: "tax", width: 13, style: { numFmt: MONEY_FORMAT } },
    { header: "IVA autorrepercutido", key: "selfAssessedTax", width: 15, style: { numFmt: MONEY_FORMAT } },
    { header: "IVA deducible", key: "deductible", width: 13, style: { numFmt: MONEY_FORMAT } },
    { header: "Retención IRPF", key: "retention", width: 14, style: { numFmt: MONEY_FORMAT } },
    { header: "Total factura", key: "total", width: 14, style: { numFmt: MONEY_FORMAT } },
    { header: "Moneda", key: "currency", width: 8 },
    { header: "Vencimiento", key: "dueDate", width: 13, style: { numFmt: DATE_FORMAT } },
    { header: "Estado de pago", key: "paymentStatus", width: 14 },
    { header: "Pagado", key: "paid", width: 13, style: { numFmt: MONEY_FORMAT } },
    { header: "Pendiente", key: "pending", width: 13, style: { numFmt: MONEY_FORMAT } },
    { header: "Pedido", key: "order", width: 14 },
    { header: "Notas", key: "notes", width: 30 },
    { header: "Documento", key: "document", width: 44 },
  ]);
  const totals = { base: 0, tax: 0, selfAssessedTax: 0, deductible: 0, retention: 0, total: 0, paid: 0, pending: 0 };

  for (const invoice of data.invoices) {
    const deductible = deductibleTaxAmount(invoice);
    const pending = round2(Math.max(invoice.totalAmount - invoice.paidAmount, 0));
    const paths = options.documentPaths?.get(invoice.id) ?? [];
    const { tax, selfAssessedTax } = taxColumns(invoice, invoice.taxAmount);
    const row = invoicesSheet.addRow({
      number: invoice.number,
      issueDate: invoice.issueDate,
      accountingDate: invoice.accountingDate,
      supplierNumber: invoice.supplierDocumentNumber ?? "",
      supplier: invoice.supplierName,
      taxId: invoice.supplierTaxId ?? "",
      country: invoice.supplierCountryCode ?? "",
      treatment: purchaseVatTreatmentLabels[invoice.vatTreatment ?? "DOMESTIC"] ?? invoice.vatTreatment ?? "",
      accounts: distinct(invoice.lines.map((line) => line.accountCode)).join(", "),
      rates: distinct(invoice.lines.map((line) => String(line.taxRate))).join(" / "),
      base: invoice.subtotalAmount,
      tax,
      selfAssessedTax: selfAssessedTax || null,
      deductible,
      retention: invoice.retentionAmount || null,
      total: invoice.totalAmount,
      currency: invoice.currencyCode,
      dueDate: invoice.dueDate,
      paymentStatus: paymentStatusLabels[invoice.paymentStatus] ?? invoice.paymentStatus,
      paid: invoice.paidAmount || null,
      pending: pending || null,
      order: invoice.purchaseOrderNumber ?? "",
      notes: invoice.notes ?? "",
      document: paths.length > 0 ? paths.join(", ") : invoice.documents.length > 0 ? "Sí (no incluido en esta exportación)" : "Sin documento",
    });
    // Enlace relativo al primer documento: al descomprimir el ZIP se abre con un clic desde Excel.
    if (paths[0]) {
      row.getCell("document").value = { text: paths.join(", "), hyperlink: paths[0] };
      row.getCell("document").font = { color: { argb: "FF0563C1" }, underline: true };
    }
    totals.base += invoice.subtotalAmount;
    totals.tax += tax;
    totals.selfAssessedTax += selfAssessedTax;
    totals.deductible += deductible;
    totals.retention += invoice.retentionAmount;
    totals.total += invoice.totalAmount;
    totals.paid += invoice.paidAmount;
    totals.pending += pending;
  }
  const totalRow = invoicesSheet.addRow({
    supplier: `Total (${data.invoices.length} facturas)`,
    base: round2(totals.base),
    tax: round2(totals.tax),
    selfAssessedTax: round2(totals.selfAssessedTax),
    deductible: round2(totals.deductible),
    retention: round2(totals.retention),
    total: round2(totals.total),
    paid: round2(totals.paid),
    pending: round2(totals.pending),
  });
  totalRow.font = { bold: true };

  const breakdownSheet = sheetWithHeader(workbook, "Desglose IVA", [
    { header: "Nº registro", key: "number", width: 16 },
    { header: "Fecha factura", key: "issueDate", width: 13, style: { numFmt: DATE_FORMAT } },
    { header: "Nº factura proveedor", key: "supplierNumber", width: 20 },
    { header: "Proveedor", key: "supplier", width: 34 },
    { header: "NIF", key: "taxId", width: 14 },
    { header: "Tipo de operación", key: "treatment", width: 26 },
    { header: "Cuenta", key: "account", width: 12 },
    { header: "Nombre de la cuenta", key: "accountName", width: 30 },
    { header: "Tipo IVA (%)", key: "rate", width: 11, style: { numFmt: PERCENT_FORMAT } },
    { header: "Base imponible", key: "base", width: 15, style: { numFmt: MONEY_FORMAT } },
    { header: "Cuota IVA", key: "tax", width: 13, style: { numFmt: MONEY_FORMAT } },
    { header: "IVA autorrepercutido", key: "selfAssessedTax", width: 15, style: { numFmt: MONEY_FORMAT } },
    { header: "% deducible", key: "deductiblePct", width: 11, style: { numFmt: PERCENT_FORMAT } },
    { header: "IVA deducible", key: "deductible", width: 13, style: { numFmt: MONEY_FORMAT } },
    { header: "Retención (%)", key: "retentionRate", width: 12, style: { numFmt: PERCENT_FORMAT } },
    { header: "Retención IRPF", key: "retention", width: 14, style: { numFmt: MONEY_FORMAT } },
  ]);
  for (const invoice of data.invoices) {
    // Agrupa por cuenta + tipo de IVA + % deducible + retención.
    const groups = new Map<string, ExpenseExportLine>();
    for (const line of invoice.lines) {
      const key = [line.accountCode, line.taxRate, line.taxDeductiblePct, line.retentionRate].join("|");
      const current = groups.get(key);
      groups.set(key, current
        ? { ...current, base: current.base + line.base, taxAmount: current.taxAmount + line.taxAmount, retentionAmount: current.retentionAmount + line.retentionAmount }
        : { ...line });
    }
    for (const line of groups.values()) {
      const { tax, selfAssessedTax } = taxColumns(invoice, round2(line.taxAmount));
      breakdownSheet.addRow({
        number: invoice.number,
        issueDate: invoice.issueDate,
        supplierNumber: invoice.supplierDocumentNumber ?? "",
        supplier: invoice.supplierName,
        taxId: invoice.supplierTaxId ?? "",
        treatment: purchaseVatTreatmentLabels[invoice.vatTreatment ?? "DOMESTIC"] ?? invoice.vatTreatment ?? "",
        account: line.accountCode ?? "",
        accountName: line.accountName ?? "",
        rate: line.taxRate,
        base: round2(line.base),
        tax,
        selfAssessedTax: selfAssessedTax || null,
        deductiblePct: round2(line.taxDeductiblePct * invoice.prorrataPct / 100),
        deductible: deductibleTaxAmount({ lines: [line], prorrataPct: invoice.prorrataPct }),
        retentionRate: line.retentionRate || null,
        retention: round2(line.retentionAmount) || null,
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** Nombre base de los ficheros: facturas-recibidas-<empresa>-<periodo>. */
export function expenseExportBaseName(companyName: string, periodLabel: string) {
  const part = (value: string) => slug(value, 40).toLowerCase();
  return `facturas-recibidas-${part(companyName) || "empresa"}-${part(periodLabel) || "periodo"}`;
}

/**
 * Exportación completa. Sin documentos devuelve solo el Excel; con documentos, un ZIP con el Excel,
 * los documentos y un LEEME con las facturas sin documento o cuyo archivo no se pudo leer.
 */
export async function buildExpenseExport(data: ExpenseExportData, options: { includeDocuments: boolean }) {
  const baseName = expenseExportBaseName(data.companyName, data.periodLabel);
  if (!options.includeDocuments) {
    return { bytes: await buildExpenseExportWorkbook(data), fileName: `${baseName}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", missing: [] as string[] };
  }

  const files: Record<string, Uint8Array> = {};
  const documentPaths = new Map<string, string[]>();
  const missing: string[] = [];
  // En serie: evita abrir decenas de lecturas a la vez contra el disco o S3.
  for (const invoice of data.invoices) {
    if (invoice.documents.length === 0) {
      missing.push(`${invoice.number} · ${invoice.supplierName}${invoice.supplierDocumentNumber ? ` · ${invoice.supplierDocumentNumber}` : ""}: sin documento adjunto.`);
      continue;
    }
    for (const [index, document] of invoice.documents.entries()) {
      const zipPath = expenseDocumentFileName(invoice, document, index);
      try {
        files[zipPath] = await document.load();
        documentPaths.set(invoice.id, [...(documentPaths.get(invoice.id) ?? []), zipPath]);
      } catch {
        missing.push(`${invoice.number} · ${invoice.supplierName}: no se pudo leer el archivo "${document.fileName}".`);
      }
    }
  }

  const workbook = await buildExpenseExportWorkbook(data, { documentPaths });
  const readme = [
    `Facturas recibidas · ${data.companyName}${data.companyTaxId ? ` (${data.companyTaxId})` : ""}`,
    `Periodo: ${data.periodLabel}`,
    `Generado: ${data.generatedAt.toISOString()}`,
    "",
    `- ${baseName}.xlsx: ${data.invoices.length} facturas (hoja "Facturas") y su desglose por cuenta y tipo de IVA (hoja "Desglose IVA").`,
    `- facturas/: ${Object.keys(files).length} documentos, nombrados <nº registro>_<proveedor>_<nº factura proveedor>. La columna "Documento" del Excel los enlaza.`,
    "",
    "Las facturas anuladas no se incluyen.",
    ...(missing.length > 0 ? ["", "Facturas sin documento en esta exportación:", ...missing.map((line) => `- ${line}`)] : []),
  ].join("\r\n");

  const zip = zipSync(
    { "LEEME.txt": strToU8(readme), [`${baseName}.xlsx`]: workbook, ...files },
    // PDF, imágenes y xlsx ya van comprimidos.
    { level: 1, mtime: data.generatedAt },
  );
  return { bytes: zip, fileName: `${baseName}.zip`, contentType: "application/zip", missing };
}
