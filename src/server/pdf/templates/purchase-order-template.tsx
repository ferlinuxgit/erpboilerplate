import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { PurchaseOrderPdfInput } from "@/server/pdf/render";

const styles = StyleSheet.create({
  page: {
    padding: 34,
    fontSize: 10.5,
    color: "#172033",
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  brand: { width: "52%" },
  mark: { width: 36, height: 4, backgroundColor: "#0f766e", marginBottom: 10 },
  company: { fontSize: 13, fontWeight: 700, marginBottom: 5 },
  muted: { color: "#5d667a", lineHeight: 1.4 },
  document: { alignItems: "flex-end" },
  eyebrow: {
    fontSize: 8,
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: { fontSize: 25, fontWeight: 700, marginBottom: 3 },
  number: { color: "#0f766e", fontSize: 12, fontWeight: 700 },
  summary: {
    flexDirection: "row",
    border: "1 solid #d7dee8",
    marginBottom: 18,
  },
  summaryItem: { flex: 1, padding: 11, borderRight: "1 solid #e5eaf0" },
  summaryLast: { flex: 1, padding: 11 },
  label: {
    fontSize: 8,
    color: "#64748b",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  value: { fontSize: 11.5, fontWeight: 700 },
  supplier: { border: "1 solid #d7dee8", padding: 12, marginBottom: 20 },
  supplierName: { fontSize: 12, fontWeight: 700, marginBottom: 5 },
  sectionTitle: {
    fontSize: 9,
    color: "#64748b",
    textTransform: "uppercase",
    fontWeight: 700,
    marginBottom: 8,
  },
  table: { border: "1 solid #d7dee8" },
  row: { flexDirection: "row", borderBottom: "1 solid #e5eaf0" },
  headerRow: { backgroundColor: "#172033", color: "#ffffff", fontWeight: 700 },
  description: { flex: 2.8, padding: 8 },
  cell: { flex: 1, padding: 8, textAlign: "right" },
  totalWrap: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 14,
  },
  totalBox: {
    width: 220,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 11,
    backgroundColor: "#0f766e",
    color: "#ffffff",
  },
  total: { fontSize: 13, fontWeight: 700 },
  footer: {
    marginTop: 20,
    borderTop: "1 solid #e5eaf0",
    paddingTop: 9,
    color: "#5d667a",
    fontSize: 8.5,
  },
});

export function PurchaseOrderPdfTemplate({
  company,
  createdAt,
  lines,
  number,
  status,
  supplier,
  total,
}: PurchaseOrderPdfInput) {
  const companyAddress = [
    company.address,
    company.postalCode,
    company.city,
    company.province,
    company.countryCode,
  ]
    .filter(Boolean)
    .join(", ");
  const supplierAddress = [
    supplier.address,
    supplier.postalCode,
    supplier.city,
    supplier.province,
    supplier.countryCode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.mark} />
            <Text style={styles.company}>
              {company.legalName || company.name}
            </Text>
            {company.vatNumber ? (
              <Text style={styles.muted}>{company.vatNumber}</Text>
            ) : null}
            {companyAddress ? (
              <Text style={styles.muted}>{companyAddress}</Text>
            ) : null}
          </View>
          <View style={styles.document}>
            <Text style={styles.eyebrow}>Documento de compra</Text>
            <Text style={styles.title}>Pedido</Text>
            <Text style={styles.number}>{number}</Text>
          </View>
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={styles.label}>Fecha</Text>
            <Text style={styles.value}>{createdAt}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.label}>Estado</Text>
            <Text style={styles.value}>{status}</Text>
          </View>
          <View style={styles.summaryLast}>
            <Text style={styles.label}>Total</Text>
            <Text style={styles.value}>{total}</Text>
          </View>
        </View>

        <View style={styles.supplier}>
          <Text style={styles.label}>Proveedor</Text>
          <Text style={styles.supplierName}>{supplier.name}</Text>
          {supplier.number ? (
            <Text style={styles.muted}>N.º proveedor {supplier.number}</Text>
          ) : null}
          {supplier.taxId ? (
            <Text style={styles.muted}>{supplier.taxId}</Text>
          ) : null}
          {supplierAddress ? (
            <Text style={styles.muted}>{supplierAddress}</Text>
          ) : null}
          {supplier.email ? (
            <Text style={styles.muted}>{supplier.email}</Text>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Detalle del pedido</Text>
        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={styles.description}>Concepto</Text>
            <Text style={styles.cell}>Cantidad</Text>
            <Text style={styles.cell}>Precio</Text>
            <Text style={styles.cell}>Importe</Text>
          </View>
          {lines.map((line) => (
            <View key={line.id} style={styles.row}>
              <Text style={styles.description}>{line.description}</Text>
              <Text style={styles.cell}>{line.quantity}</Text>
              <Text style={styles.cell}>{line.unitPrice}</Text>
              <Text style={styles.cell}>{line.lineTotal}</Text>
            </View>
          ))}
        </View>
        <View style={styles.totalWrap}>
          <View style={styles.totalBox}>
            <Text style={styles.total}>Total pedido</Text>
            <Text style={styles.total}>{total}</Text>
          </View>
        </View>
        <Text style={styles.footer}>
          Pedido emitido por {company.legalName || company.name}. Este documento
          no constituye una factura.
        </Text>
      </Page>
    </Document>
  );
}
