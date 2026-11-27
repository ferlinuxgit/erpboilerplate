import ExcelJS from "exceljs";

/**
 * Documento tabular genérico (libros oficiales y cuentas anuales): la misma estructura se vuelca a
 * XLSX (una hoja por sección) y a PDF (`document-pdf.tsx`).
 */

export type DocColumn = { header: string; /** Ancho relativo (1 = columna de importe). */ width?: number; align?: "left" | "right" };

export type DocRow = {
  /** Texto, importe en euros (número) o celda vacía (null). */
  cells: Array<string | number | null>;
  strong?: boolean;
  /** Sangría de la primera celda (0-3). */
  indent?: number;
};

export type DocTable = { title?: string; columns: DocColumn[]; rows: DocRow[]; note?: string };

export type DocSection = {
  /** Título de la sección y nombre de la hoja en XLSX (máx. 31 caracteres). */
  heading: string;
  sheetName?: string;
  paragraphs?: string[];
  tables?: DocTable[];
};

export type BookDocument = {
  title: string;
  /** Empresa, NIF y ejercicio. */
  subtitle: string;
  sections: DocSection[];
  /** Tablas anchas (diario, mayor, estado de cambios): PDF apaisado. */
  landscape?: boolean;
};

export function documentRowCount(document: BookDocument) {
  return document.sections.reduce((total, section) => total + (section.tables ?? []).reduce((sum, table) => sum + table.rows.length, 0), 0);
}

const MONEY_FORMAT = "#,##0.00;[Red]-#,##0.00";

function sheetName(section: DocSection, used: Set<string>) {
  const base = (section.sheetName ?? section.heading).replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Hoja";
  let name = base;
  for (let index = 2; used.has(name.toLowerCase()); index += 1) name = `${base.slice(0, 28)} ${index}`;
  used.add(name.toLowerCase());
  return name;
}

/** Libro de Excel con una hoja por sección; `generatedAt` fija las fechas internas del fichero. */
export async function renderDocumentXlsx(document: BookDocument, generatedAt: Date): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Norpie";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  const used = new Set<string>();
  for (const section of document.sections) {
    const sheet = workbook.addWorksheet(sheetName(section, used));
    const widest = Math.max(1, ...(section.tables ?? []).map((table) => table.columns.length));
    sheet.addRow([document.title]).font = { bold: true, size: 13 };
    sheet.addRow([document.subtitle]);
    sheet.addRow([section.heading]).font = { bold: true };
    sheet.addRow([]);
    for (const paragraph of section.paragraphs ?? []) {
      for (const text of paragraph.split("\n")) {
        const row = sheet.addRow([text]);
        row.getCell(1).alignment = { wrapText: true, vertical: "top" };
        if (widest > 1) sheet.mergeCells(row.number, 1, row.number, Math.max(widest, 6));
        row.height = Math.max(15, Math.ceil(text.length / 110) * 15);
      }
      sheet.addRow([]);
    }
    for (const table of section.tables ?? []) {
      if (table.title) sheet.addRow([table.title]).font = { bold: true };
      const header = sheet.addRow(table.columns.map((column) => column.header));
      header.font = { bold: true };
      header.eachCell((cell, index) => {
        cell.border = { bottom: { style: "thin" } };
        cell.alignment = { horizontal: table.columns[index - 1]?.align === "right" ? "right" : "left", wrapText: true };
      });
      for (const item of table.rows) {
        const row = sheet.addRow(item.cells.map((cell) => cell ?? ""));
        if (item.strong) row.font = { bold: true };
        row.eachCell((cell, index) => {
          if (typeof cell.value === "number") cell.numFmt = MONEY_FORMAT;
          if (index === 1 && item.indent) cell.alignment = { indent: item.indent * 2 };
        });
      }
      if (table.note) sheet.addRow([table.note]).font = { italic: true };
      sheet.addRow([]);
      table.columns.forEach((column, index) => {
        const sheetColumn = sheet.getColumn(index + 1);
        const width = Math.round((column.width ?? 1) * 16);
        if (!sheetColumn.width || sheetColumn.width < width) sheetColumn.width = width;
      });
    }
    if (!section.tables?.length) sheet.getColumn(1).width = 110;
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

const moneyFormatter = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });

/** Celda como texto para el PDF: importes en formato español, vacío si es null. */
export function formatDocCell(cell: string | number | null) {
  if (cell === null) return "";
  return typeof cell === "number" ? moneyFormatter.format(cell) : cell;
}
