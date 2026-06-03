import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { InvoicePdfInput } from "@/server/pdf/render";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, color: "#111827" },
  title: { fontSize: 20, marginBottom: 6 },
  meta: { color: "#4b5563", marginBottom: 18 },
  grid: { flexDirection: "row", gap: 24, marginBottom: 18 },
  party: { flex: 1, border: "1 solid #d1d5db", padding: 10 },
  label: { fontSize: 9, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" },
  line: { marginBottom: 4 },
  table: { border: "1 solid #d1d5db", marginTop: 8 },
  tableRow: { flexDirection: "row", borderBottom: "1 solid #e5e7eb" },
  tableHeader: { backgroundColor: "#f3f4f6", fontWeight: 700 },
  descriptionCell: { flex: 2.4, padding: 6 },
  cell: { flex: 1, padding: 6, textAlign: "right" },
  totals: { marginTop: 12, marginLeft: "auto", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  totalBox: { marginTop: 12, padding: 10, backgroundColor: "#f3f4f6" },
  total: { fontSize: 14, fontWeight: 700 },
  footer: { marginTop: 18, borderTop: "1 solid #e5e7eb", paddingTop: 8, color: "#4b5563", fontSize: 9 },
});

function formatAddress(party: InvoicePdfInput["customer"] | InvoicePdfInput["company"]) {
  return [
    "address" in party ? party.address : party.fiscalAddress,
    "addressLine2" in party ? party.addressLine2 : party.fiscalAddressLine2,
    [party.postalCode, party.city].filter(Boolean).join(" "),
    party.province,
    party.countryCode,
  ]
    .filter(Boolean)
    .join(", ");
}

export function InvoicePdfTemplate({ company, customer, dueDate, issueDate, lines, number, totals }: InvoicePdfInput) {
  const companyName = company.legalName?.trim() || company.name;
  const companyAddress = formatAddress(company);
  const companyContact = [company.email, company.phone, company.website].filter(Boolean).join(" | ");
  const customerAddress = formatAddress(customer);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Factura {number}</Text>
        <Text style={styles.meta}>
          Fecha de emision: {issueDate}
          {dueDate ? ` | Vencimiento: ${dueDate}` : ""}
        </Text>
        <View style={styles.grid}>
          <View style={styles.party}>
            <Text style={styles.label}>Emisor</Text>
            <Text style={styles.line}>{companyName}</Text>
            {company.vatNumber ? <Text style={styles.line}>CIF/NIF: {company.vatNumber}</Text> : null}
            {companyAddress ? <Text style={styles.line}>Domicilio fiscal: {companyAddress}</Text> : null}
            {companyContact ? <Text style={styles.line}>{companyContact}</Text> : null}
          </View>
          <View style={styles.party}>
            <Text style={styles.label}>Cliente</Text>
            <Text style={styles.line}>{customer.name}</Text>
            {customer.taxId ? <Text style={styles.line}>CIF/NIF: {customer.taxId}</Text> : null}
            {customerAddress ? <Text style={styles.line}>Domicilio fiscal: {customerAddress}</Text> : null}
          </View>
        </View>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={styles.descriptionCell}>Concepto</Text>
            <Text style={styles.cell}>Cantidad</Text>
            <Text style={styles.cell}>Precio</Text>
            <Text style={styles.cell}>IVA</Text>
            <Text style={styles.cell}>Importe</Text>
          </View>
          {lines.map((line, index) => (
            <View key={`${line.description}-${index}`} style={styles.tableRow}>
              <Text style={styles.descriptionCell}>{line.description}</Text>
              <Text style={styles.cell}>{line.quantity}</Text>
              <Text style={styles.cell}>{line.unitPrice}</Text>
              <Text style={styles.cell}>{line.taxRate}</Text>
              <Text style={styles.cell}>{line.lineTotal}</Text>
            </View>
          ))}
        </View>
        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Base imponible</Text>
            <Text>{totals.subtotal}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>IVA</Text>
            <Text>{totals.taxAmount}</Text>
          </View>
          {totals.hasRetention ? (
            <View style={styles.totalRow}>
              <Text>Retencion</Text>
              <Text>{totals.retentionAmount}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.totalBox}>
          <Text style={styles.total}>Importe: {totals.totalAmount}</Text>
        </View>
        {company.invoiceFooter ? <Text style={styles.footer}>{company.invoiceFooter}</Text> : null}
      </Page>
    </Document>
  );
}
