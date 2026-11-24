import ExcelJS from "exceljs";
import { strToU8, zipSync } from "fflate";

/**
 * Ficheros del portal del asesor sin base de datos: Excel con cabecera fija y autofiltro, nombres
 * de fichero estables y el ZIP de facturas emitidas (PDF + listado enlazado).
 */

export type SheetColumnType = "text" | "money" | "date" | "number" | "percent";

export type SheetColumn<Row> = {
  header: string;
  width?: number;
  type?: SheetColumnType;
  value: (row: Row) => string | number | Date | null | undefined;
  /** Hipervínculo relativo (p. ej. al PDF dentro del ZIP). */
  link?: (row: Row) => string | null | undefined;
  /** Suma la columna en una fila final de totales. */
  total?: boolean;
};

export type SheetSpec<Row> = { name: string; columns: SheetColumn<Row>[]; rows: Row[] };

const MONEY_FORMAT = "#,##0.00;-#,##0.00";
const DATE_FORMAT = "dd/mm/yyyy";

function columnFormat(type: SheetColumnType | undefined) {
  if (type === "money") return MONEY_FORMAT;
  if (type === "date") return DATE_FORMAT;
  if (type === "percent") return "0.00";
  return undefined;
}

export type WorkbookMeta = { title: string; companyName: string; companyTaxId: string | null; periodLabel: string; generatedAt: Date };

/** Excel con una hoja por `sheets`. Las hojas sin filas se incluyen (con la cabecera) para que se vea que no hay datos. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cada hoja tiene su propio tipo de fila
export async function buildAdvisorWorkbook(meta: WorkbookMeta, sheets: Array<SheetSpec<any>>) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Norpie · Portal del asesor";
  workbook.created = meta.generatedAt;
  workbook.title = `${meta.title} · ${meta.companyName} · ${meta.periodLabel}`;
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name.slice(0, 31));
    sheet.columns = spec.columns.map((column, index) => ({ header: column.header, key: `c${index}`, width: column.width ?? 16, style: columnFormat(column.type) ? { numFmt: columnFormat(column.type) } : {} }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    if (spec.columns.length > 0) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
    for (const row of spec.rows) {
      const values: Record<string, unknown> = {};
      spec.columns.forEach((column, index) => {
        const value = column.value(row);
        const link = column.link?.(row);
        values[`c${index}`] = link && value !== null && value !== undefined ? { text: String(value), hyperlink: link } : value ?? null;
      });
      const added = sheet.addRow(values);
      spec.columns.forEach((column, index) => {
        if (column.link?.(row)) added.getCell(index + 1).font = { color: { argb: "FF0563C1" }, underline: true };
      });
    }
    if (spec.rows.length > 0 && spec.columns.some((column) => column.total)) {
      const totals: Record<string, unknown> = { c0: "Total" };
      spec.columns.forEach((column, index) => {
        if (!column.total) return;
        totals[`c${index}`] = round2(spec.rows.reduce((sum, row) => sum + Number(column.value(row) ?? 0), 0));
      });
      sheet.addRow(totals).font = { bold: true };
    }
  }
  // Hoja de portada: quién, qué y cuándo (útil cuando el asesor archiva el fichero).
  const about = workbook.addWorksheet("Información");
  about.columns = [{ key: "k", width: 22 }, { key: "v", width: 60 }];
  about.addRows([
    { k: "Empresa", v: meta.companyName },
    { k: "NIF", v: meta.companyTaxId ?? "" },
    { k: "Contenido", v: meta.title },
    { k: "Periodo", v: meta.periodLabel },
    { k: "Generado", v: meta.generatedAt.toISOString() },
  ]);
  about.getColumn(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Texto apto para nombre de fichero: sin acentos ni símbolos, con guiones. */
export function fileSlug(value: string, max = 40) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

/** `<tipo>-<empresa>-<periodo>` en minúsculas (p. ej. `facturas-emitidas-acme-3-o-trimestre-2026`). */
export function advisorFileBaseName(kind: string, companyName: string, periodLabel: string) {
  return [kind, fileSlug(companyName).toLowerCase() || "empresa", fileSlug(periodLabel).toLowerCase() || "periodo"].join("-");
}

export type SalesExportInvoice = {
  id: string;
  number: string;
  invoiceType: "INVOICE" | "CREDIT_NOTE";
  rectifiedNumber: string | null;
  issueDate: Date;
  dueDate: Date | null;
  lifecycle: "ISSUED" | "VOID" | "DRAFT";
  customerName: string;
  customerTaxId: string | null;
  customerCountryCode: string | null;
  vatTreatment: string | null;
  subtotal: number;
  taxAmount: number;
  retentionAmount: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  paymentStatus: string;
};

const vatTreatmentLabels: Record<string, string> = {
  DOMESTIC: "Nacional",
  INTRA_EU: "Entrega intracomunitaria",
  INTRA_EU_SERVICES: "Servicios intracomunitarios",
  EXPORT: "Exportación",
  EXEMPT: "Exenta",
  REVERSE_CHARGE: "Inversión del sujeto pasivo",
  NOT_SUBJECT: "No sujeta",
};

const paymentStatusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  PARTIAL: "Cobro parcial",
  PAID: "Cobrada",
  OVERDUE: "Vencida",
  VOID: "Anulada",
};

/** `facturas/<número>_<cliente>.pdf` (el ZIP desambigua si se repite). */
export function salesPdfPath(invoice: Pick<SalesExportInvoice, "number" | "customerName">) {
  return `facturas/${fileSlug(invoice.number, 40) || "factura"}_${fileSlug(invoice.customerName, 40) || "cliente"}.pdf`;
}

export function salesColumns(options: { pdfPaths?: Map<string, string> } = {}): SheetColumn<SalesExportInvoice>[] {
  return [
    { header: "Número", width: 16, value: (row) => row.number, link: options.pdfPaths ? (row) => options.pdfPaths?.get(row.id) : undefined },
    { header: "Tipo", width: 14, value: (row) => (row.invoiceType === "CREDIT_NOTE" ? "Rectificativa" : "Factura") },
    { header: "Rectifica a", width: 14, value: (row) => row.rectifiedNumber ?? "" },
    { header: "Fecha", width: 12, type: "date", value: (row) => row.issueDate },
    { header: "Vencimiento", width: 12, type: "date", value: (row) => row.dueDate },
    { header: "Cliente", width: 34, value: (row) => row.customerName },
    { header: "NIF cliente", width: 16, value: (row) => row.customerTaxId ?? "" },
    { header: "País", width: 6, value: (row) => row.customerCountryCode ?? "" },
    { header: "Operación", width: 22, value: (row) => (row.vatTreatment ? vatTreatmentLabels[row.vatTreatment] ?? row.vatTreatment : "Automática (según cliente)") },
    { header: "Base imponible", width: 14, type: "money", total: true, value: (row) => row.subtotal },
    { header: "Cuota IVA", width: 12, type: "money", total: true, value: (row) => row.taxAmount },
    { header: "Retención IRPF", width: 13, type: "money", total: true, value: (row) => row.retentionAmount },
    { header: "Total", width: 13, type: "money", total: true, value: (row) => row.totalAmount },
    { header: "Cobrado", width: 13, type: "money", total: true, value: (row) => row.paidAmount },
    { header: "Pendiente", width: 13, type: "money", total: true, value: (row) => row.outstandingAmount },
    { header: "Estado de cobro", width: 15, value: (row) => paymentStatusLabels[row.paymentStatus] ?? row.paymentStatus },
    { header: "Estado", width: 10, value: (row) => (row.lifecycle === "VOID" ? "Anulada" : "Emitida") },
  ];
}

/**
 * ZIP de facturas emitidas: el listado en Excel (con el número enlazado a su PDF), los PDF en
 * `facturas/` y un LEEME con las que no se pudieron generar.
 */
export async function buildSalesZip(input: {
  meta: WorkbookMeta;
  baseName: string;
  invoices: SalesExportInvoice[];
  loadPdf: (invoice: SalesExportInvoice) => Promise<Uint8Array | null>;
}) {
  const files: Record<string, Uint8Array> = {};
  const pdfPaths = new Map<string, string>();
  const missing: string[] = [];
  // En serie: renderizar PDF es costoso y no conviene saturar la base de datos ni el almacenamiento.
  for (const invoice of input.invoices) {
    let path = salesPdfPath(invoice);
    if (files[path]) path = path.replace(/\.pdf$/, `_${invoice.id.slice(0, 8)}.pdf`);
    try {
      const bytes = await input.loadPdf(invoice);
      if (!bytes) {
        missing.push(`${invoice.number} · ${invoice.customerName}: no se pudo generar el PDF.`);
        continue;
      }
      files[path] = bytes;
      pdfPaths.set(invoice.id, path);
    } catch {
      missing.push(`${invoice.number} · ${invoice.customerName}: no se pudo generar el PDF.`);
    }
  }
  const workbook = await buildAdvisorWorkbook(input.meta, [{ name: "Facturas emitidas", columns: salesColumns({ pdfPaths }), rows: input.invoices }]);
  const readme = [
    `${input.meta.title} · ${input.meta.companyName}${input.meta.companyTaxId ? ` (${input.meta.companyTaxId})` : ""}`,
    `Periodo: ${input.meta.periodLabel}`,
    `Generado: ${input.meta.generatedAt.toISOString()}`,
    "",
    `- ${input.baseName}.xlsx: ${input.invoices.length} facturas. El número de cada factura enlaza con su PDF.`,
    `- facturas/: ${pdfPaths.size} PDF, nombrados <número>_<cliente>. Son la copia conservada al emitir cada factura.`,
    "",
    "No se incluyen borradores. Las rectificativas llevan importes negativos.",
    ...(missing.length > 0 ? ["", "Facturas sin PDF en esta descarga:", ...missing.map((line) => `- ${line}`)] : []),
  ].join("\r\n");
  const bytes = zipSync({ "LEEME.txt": strToU8(readme), [`${input.baseName}.xlsx`]: workbook, ...files }, { level: 1, mtime: input.meta.generatedAt });
  return { bytes, missing };
}
