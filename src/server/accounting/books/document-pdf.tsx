import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

import { HttpError } from "@/lib/http";
import { documentRowCount, formatDocCell, type BookDocument, type DocTable } from "@/server/accounting/books/document";

/**
 * PDF de un libro o de las cuentas anuales. Maquetar decenas de miles de filas en PDF consume mucha
 * memoria: por encima de este límite se pide usar el formato Excel, que Legalia 2 admite igual.
 */
export const PDF_MAX_ROWS = 6000;

const styles = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 40, paddingHorizontal: 30, fontSize: 8, color: "#111827" },
  title: { fontSize: 14, marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#4b5563", marginBottom: 12 },
  heading: { fontSize: 11, marginTop: 10, marginBottom: 6 },
  paragraph: { marginBottom: 6, lineHeight: 1.4, fontSize: 9 },
  tableTitle: { fontSize: 9, marginTop: 6, marginBottom: 3 },
  headerRow: { flexDirection: "row", borderBottom: "1 solid #111827", paddingVertical: 3 },
  row: { flexDirection: "row", borderBottom: "0.5 solid #e5e7eb", paddingVertical: 2 },
  strong: { fontFamily: "Helvetica-Bold" },
  note: { fontSize: 7, color: "#4b5563", marginTop: 2, marginBottom: 4 },
  footer: { position: "absolute", bottom: 18, left: 30, right: 30, fontSize: 7, color: "#6b7280", flexDirection: "row", justifyContent: "space-between" },
});

function Table({ table }: { table: DocTable }) {
  const cellStyle = (index: number, indent = 0) => ({
    flex: table.columns[index]?.width ?? 1,
    textAlign: table.columns[index]?.align === "right" ? ("right" as const) : ("left" as const),
    paddingRight: 4,
    paddingLeft: index === 0 ? indent * 8 : 0,
  });
  return (
    <View>
      {table.title ? <Text style={[styles.tableTitle, styles.strong]}>{table.title}</Text> : null}
      <View fixed style={[styles.headerRow, styles.strong]}>
        {table.columns.map((column, index) => <Text key={index} style={cellStyle(index)}>{column.header}</Text>)}
      </View>
      {table.rows.map((row, rowIndex) => (
        <View key={rowIndex} style={row.strong ? [styles.row, styles.strong] : styles.row} wrap={false}>
          {table.columns.map((_, index) => <Text key={index} style={cellStyle(index, row.indent)}>{formatDocCell(row.cells[index] ?? null)}</Text>)}
        </View>
      ))}
      {table.note ? <Text style={styles.note}>{table.note}</Text> : null}
    </View>
  );
}

export async function renderDocumentPdf(document: BookDocument, generatedAt: Date): Promise<Uint8Array> {
  if (documentRowCount(document) > PDF_MAX_ROWS) {
    throw new HttpError(422, `Este libro tiene más de ${new Intl.NumberFormat("es-ES").format(PDF_MAX_ROWS)} filas: descárgalo en Excel (XLSX), que el Registro Mercantil admite igual.`);
  }
  const buffer = await renderToBuffer(
    <Document creationDate={generatedAt} modificationDate={generatedAt} title={document.title} producer="Norpie" creator="Norpie">
      {document.sections.map((section, index) => (
        <Page key={index} orientation={document.landscape ? "landscape" : "portrait"} size="A4" style={styles.page}>
          <Text style={styles.title}>{document.title}</Text>
          <Text style={styles.subtitle}>{document.subtitle}</Text>
          <Text style={[styles.heading, styles.strong]}>{section.heading}</Text>
          {(section.paragraphs ?? []).flatMap((paragraph, paragraphIndex) => paragraph.split("\n").filter((line) => line.trim() !== "").map((line, lineIndex) => (
            <Text key={`${paragraphIndex}-${lineIndex}`} style={styles.paragraph}>{line}</Text>
          )))}
          {(section.tables ?? []).map((table, tableIndex) => <Table key={tableIndex} table={table} />)}
          <View fixed style={styles.footer}>
            <Text>{document.title} · {document.subtitle}</Text>
            <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
          </View>
        </Page>
      ))}
    </Document>,
  );
  return new Uint8Array(buffer);
}
