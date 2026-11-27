import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import type { DeclarationRow } from "@/server/verifactu/declaration";

const styles = StyleSheet.create({
  page: { paddingVertical: 36, paddingHorizontal: 40, fontSize: 9.5, color: "#111827", lineHeight: 1.35 },
  title: { fontSize: 13, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 9, color: "#4b5563", marginBottom: 14 },
  row: { borderBottom: "1 solid #e5e7eb", paddingVertical: 6 },
  label: { color: "#4b5563", marginBottom: 2 },
  value: { fontFamily: "Helvetica-Bold" },
  footer: { marginTop: 14, fontSize: 8, color: "#6b7280" },
});

const issued = (date: Date) => new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(date);

export type DeclarationPdfInput = { title: string; version: string; rows: DeclarationRow[]; issuedAt: Date | null };

/** Declaración responsable en PDF: los mismos apartados y literales que la pantalla. */
export function DeclarationPdfTemplate({ title, version, rows, issuedAt }: DeclarationPdfInput) {
  return (
    <Document title={`Declaración responsable · versión ${version}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>
          Art. 13 del Real Decreto 1007/2023 y art. 15 de la Orden HAC/1177/2024 · Versión {version}
        </Text>
        {rows.map((row) => (
          <View key={row.label} style={styles.row} wrap={false}>
            <Text style={styles.label}>{row.label}</Text>
            <Text style={styles.value}>{row.value}</Text>
          </View>
        ))}
        <Text style={styles.footer}>
          {issuedAt ? `Declaración emitida en el sistema para esta versión el ${issued(issuedAt)}.` : "Declaración incompleta: faltan datos del productor del sistema."}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderDeclarationPdf(input: DeclarationPdfInput) {
  return renderToBuffer(<DeclarationPdfTemplate {...input} />);
}
