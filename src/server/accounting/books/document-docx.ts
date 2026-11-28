import { strToU8, zipSync, type Zippable } from "fflate";

import { formatDocCell, type BookDocument, type DocTable } from "@/server/accounting/books/document";

/**
 * Documento tabular (`BookDocument`) a Word (.docx, Office Open XML, ISO/IEC 29500). Un .docx es un
 * ZIP con partes XML; aquí se escribe el mínimo válido: tipos de contenido, relaciones, estilos
 * (título, encabezados y tabla con bordes), propiedades del documento y el cuerpo con títulos,
 * párrafos y tablas. Así la memoria y las cuentas anuales se pueden terminar de redactar en un
 * procesador de textos. Función pura: `generatedAt` fija las fechas internas del fichero.
 */

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Escapa texto para XML y quita los caracteres de control que XML 1.0 no admite. */
function xml(text: string) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function run(text: string, options: { bold?: boolean; italic?: boolean } = {}) {
  const props = `${options.bold ? "<w:b/>" : ""}${options.italic ? "<w:i/>" : ""}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

function paragraph(text: string, options: { style?: string; bold?: boolean; italic?: boolean; align?: "left" | "right"; indent?: number; keepNext?: boolean } = {}) {
  const props = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : "",
    options.keepNext ? "<w:keepNext/>" : "",
    options.indent ? `<w:ind w:left="${options.indent * 240}"/>` : "",
    options.align === "right" ? `<w:jc w:val="right"/>` : "",
  ].join("");
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${text ? run(text, options) : ""}</w:p>`;
}

/** Ancho útil de la página en vigésimos de punto (A4 con márgenes de 2 cm). */
const usableWidth = (landscape: boolean) => (landscape ? 16838 : 11906) - 2 * 1134;

function table(source: DocTable, landscape: boolean) {
  const totalWeight = source.columns.reduce((sum, column) => sum + (column.width ?? 1), 0) || 1;
  const widths = source.columns.map((column) => Math.floor(((column.width ?? 1) / totalWeight) * usableWidth(landscape)));
  const cell = (content: string, width: number) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${source.columns
    .map((column, index) => cell(paragraph(column.header, { bold: true, align: column.align }), widths[index]))
    .join("")}</w:tr>`;
  const rows = source.rows.map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${source.columns
    .map((column, index) => {
      const value = row.cells[index] ?? null;
      const align = typeof value === "number" ? "right" : column.align;
      return cell(paragraph(formatDocCell(value), { bold: row.strong, align, indent: index === 0 ? row.indent : undefined }), widths[index]);
    })
    .join("")}</w:tr>`);
  return [
    source.title ? paragraph(source.title, { style: "Heading2", keepNext: true }) : "",
    `<w:tbl><w:tblPr><w:tblStyle w:val="NorpieTable"/><w:tblW w:w="${usableWidth(landscape)}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>`,
    `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`,
    header,
    ...rows,
    "</w:tbl>",
    source.note ? paragraph(source.note, { italic: true }) : paragraph(""),
  ].join("");
}

function documentXml(document: BookDocument) {
  const landscape = Boolean(document.landscape);
  const body: string[] = [paragraph(document.title, { style: "Title" }), paragraph(document.subtitle, { italic: true })];
  for (const section of document.sections) {
    body.push(paragraph(section.heading, { style: "Heading1", keepNext: true }));
    for (const text of section.paragraphs ?? []) {
      for (const line of text.split("\n")) body.push(paragraph(line));
    }
    for (const item of section.tables ?? []) body.push(table(item, landscape));
  }
  const pageSize = landscape ? `<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>` : `<w:pgSz w:w="11906" w:h="16838"/>`;
  body.push(`<w:sectPr>${pageSize}<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${body.join("")}</w:body></w:document>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="NorpieTable"><w:name w:val="Tabla Norpie"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

function coreXml(title: string, generatedAt: Date) {
  const stamp = `${generatedAt.toISOString().slice(0, 19)}Z`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Norpie</dc:creator><dc:language>es-ES</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`;
}

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Norpie</Application></Properties>`;

/** Fichero .docx del documento. */
export function renderDocumentDocx(document: BookDocument, generatedAt: Date): Uint8Array {
  // Los ZIP guardan la hora local en formato DOS; se fija para que el mismo documento dé el mismo fichero.
  const mtime = new Date(Date.UTC(generatedAt.getUTCFullYear(), generatedAt.getUTCMonth(), generatedAt.getUTCDate(), 12));
  const files: Zippable = {
    "[Content_Types].xml": [strToU8(CONTENT_TYPES_XML), { mtime }],
    "_rels/.rels": [strToU8(ROOT_RELS_XML), { mtime }],
    "docProps/core.xml": [strToU8(coreXml(document.title, generatedAt)), { mtime }],
    "docProps/app.xml": [strToU8(APP_XML), { mtime }],
    "word/_rels/document.xml.rels": [strToU8(DOCUMENT_RELS_XML), { mtime }],
    "word/styles.xml": [strToU8(STYLES_XML), { mtime }],
    "word/document.xml": [strToU8(documentXml(document)), { mtime }],
  };
  return zipSync(files, { level: 6 });
}
