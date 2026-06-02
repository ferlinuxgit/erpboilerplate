import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { InvoicePdfInput } from "@/server/pdf/render";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, color: "#111827" },
  title: { fontSize: 20, marginBottom: 18 },
  grid: { flexDirection: "row", gap: 24, marginBottom: 18 },
  party: { flex: 1, border: "1 solid #d1d5db", padding: 10 },
  label: { fontSize: 9, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" },
  line: { marginBottom: 4 },
  totalBox: { marginTop: 12, padding: 10, backgroundColor: "#f3f4f6" },
  total: { fontSize: 14, fontWeight: 700 },
});

function formatAddress(customer: InvoicePdfInput["customer"]) {
  return [
    customer.address,
    customer.addressLine2,
    [customer.postalCode, customer.city].filter(Boolean).join(" "),
    customer.province,
    customer.countryCode,
  ]
    .filter(Boolean)
    .join(", ");
}

export function InvoicePdfTemplate({ amount, company, customer, number }: InvoicePdfInput) {
  const companyName = company.legalName?.trim() || company.name;
  const customerAddress = formatAddress(customer);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Factura {number}</Text>
        <View style={styles.grid}>
          <View style={styles.party}>
            <Text style={styles.label}>Emisor</Text>
            <Text style={styles.line}>{companyName}</Text>
            {company.vatNumber ? <Text style={styles.line}>CIF/NIF: {company.vatNumber}</Text> : null}
          </View>
          <View style={styles.party}>
            <Text style={styles.label}>Cliente</Text>
            <Text style={styles.line}>{customer.name}</Text>
            {customer.taxId ? <Text style={styles.line}>CIF/NIF: {customer.taxId}</Text> : null}
            {customerAddress ? <Text style={styles.line}>Domicilio fiscal: {customerAddress}</Text> : null}
          </View>
        </View>
        <View style={styles.totalBox}>
          <Text style={styles.total}>Importe: {amount}</Text>
        </View>
      </Page>
    </Document>
  );
}
