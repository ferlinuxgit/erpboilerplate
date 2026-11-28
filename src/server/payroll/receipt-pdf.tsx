import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { formatEuros, type PayrollReceipt, type ReceiptLine } from "@/server/payroll/receipt-model";

const styles = StyleSheet.create({
  page: { paddingVertical: 36, paddingHorizontal: 40, fontSize: 9.5, color: "#111827", lineHeight: 1.35 },
  title: { fontSize: 13, marginBottom: 2, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 9, color: "#4b5563", marginBottom: 12 },
  parties: { flexDirection: "row", marginBottom: 12 },
  party: { flex: 1, border: "1 solid #d1d5db", padding: 8, marginRight: 6 },
  partyLast: { flex: 1, border: "1 solid #d1d5db", padding: 8 },
  partyLabel: { fontSize: 8, color: "#6b7280", marginBottom: 2, textTransform: "uppercase" },
  bold: { fontFamily: "Helvetica-Bold" },
  section: { marginBottom: 10 },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 10, borderBottom: "1 solid #111827", paddingBottom: 2, marginBottom: 3 },
  row: { flexDirection: "row", borderBottom: "1 solid #e5e7eb", paddingVertical: 3 },
  rowLabel: { flex: 1 },
  rowNote: { width: 120, color: "#6b7280", fontSize: 8.5 },
  rowAmount: { width: 90, textAlign: "right" },
  total: { flexDirection: "row", paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  net: { flexDirection: "row", marginTop: 4, padding: 8, backgroundColor: "#f3f4f6", fontFamily: "Helvetica-Bold", fontSize: 11 },
  footer: { marginTop: 18, fontSize: 8, color: "#6b7280" },
  signatures: { flexDirection: "row", marginTop: 28 },
  signature: { flex: 1, borderTop: "1 solid #9ca3af", paddingTop: 4, marginRight: 20, fontSize: 8, color: "#4b5563" },
});

function Lines({ lines }: { lines: ReceiptLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <View key={`${index}-${line.label}`} style={styles.row} wrap={false}>
          <Text style={styles.rowLabel}>{line.label}</Text>
          <Text style={styles.rowNote}>{line.note ?? ""}</Text>
          <Text style={styles.rowAmount}>{formatEuros(line.cents)}</Text>
        </View>
      ))}
    </>
  );
}

/** Recibo de salarios sencillo: datos de empresa y trabajador, devengos, deducciones y líquido. */
export function PayrollReceiptPdfTemplate({ receipt }: { receipt: PayrollReceipt }) {
  return (
    <Document title={`${receipt.title} · ${receipt.periodLabel} · ${receipt.employee.name}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Recibo de salarios · {receipt.title}</Text>
        <Text style={styles.subtitle}>Periodo: {receipt.periodLabel} · Fecha: {receipt.accrualDate.split("-").reverse().join("/")}</Text>
        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.partyLabel}>Empresa</Text>
            <Text style={styles.bold}>{receipt.company.name}</Text>
            {receipt.company.taxId ? <Text>NIF: {receipt.company.taxId}</Text> : null}
            {receipt.company.address ? <Text>{receipt.company.address}</Text> : null}
          </View>
          <View style={styles.partyLast}>
            <Text style={styles.partyLabel}>Trabajador</Text>
            <Text style={styles.bold}>{receipt.employee.name}</Text>
            {receipt.employee.taxId ? <Text>NIF: {receipt.employee.taxId}</Text> : null}
            {receipt.employee.socialSecurityNumber ? <Text>N.º de afiliación: {receipt.employee.socialSecurityNumber}</Text> : null}
            {receipt.employee.startDate ? <Text>Antigüedad: {receipt.employee.startDate.split("-").reverse().join("/")}</Text> : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Devengos</Text>
          <Lines lines={receipt.earnings} />
          <View style={styles.total}>
            <Text style={styles.rowLabel}>Total devengado</Text>
            <Text style={styles.rowAmount}>{formatEuros(receipt.totalEarningsCents)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Deducciones</Text>
          {receipt.deductions.length > 0 ? <Lines lines={receipt.deductions} /> : <Text style={styles.rowNote}>Sin deducciones.</Text>}
          <View style={styles.total}>
            <Text style={styles.rowLabel}>Total a deducir</Text>
            <Text style={styles.rowAmount}>{formatEuros(receipt.totalDeductionsCents)}</Text>
          </View>
        </View>

        <View style={styles.net}>
          <Text style={styles.rowLabel}>Líquido total a percibir</Text>
          <Text style={styles.rowAmount}>{formatEuros(receipt.netCents)}</Text>
        </View>

        {receipt.information.length > 0 ? (
          <View style={[styles.section, { marginTop: 10 }]}>
            <Text style={styles.sectionTitle}>Información</Text>
            <Lines lines={receipt.information} />
          </View>
        ) : null}

        <View style={styles.signatures}>
          <Text style={styles.signature}>Firma y sello de la empresa</Text>
          <Text style={styles.signature}>Recibí (firma del trabajador)</Text>
        </View>

        <View style={styles.footer}>
          {receipt.notes.map((note) => <Text key={note}>{note}</Text>)}
        </View>
      </Page>
    </Document>
  );
}

export async function renderPayrollReceiptPdf(receipt: PayrollReceipt) {
  return renderToBuffer(<PayrollReceiptPdfTemplate receipt={receipt} />);
}
