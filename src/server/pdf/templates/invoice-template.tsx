import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { InvoicePdfInput } from "@/server/pdf/render";

const styles = StyleSheet.create({
  page: { padding: 34, fontSize: 10.5, color: "#172033", backgroundColor: "#ffffff" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 },
  brandBlock: { width: "48%" },
  brandMark: { width: 36, height: 4, backgroundColor: "#0f766e", marginBottom: 10 },
  logo: { width: 120, height: 42, objectFit: "contain", marginBottom: 8 },
  brandName: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  brandMeta: { color: "#5d667a", lineHeight: 1.35 },
  invoiceBlock: { width: "46%", alignItems: "flex-end" },
  eyebrow: { fontSize: 8, color: "#64748b", marginBottom: 4, textTransform: "uppercase" },
  title: { fontSize: 28, fontWeight: 700, marginBottom: 2 },
  number: { fontSize: 12, color: "#0f766e", fontWeight: 700 },
  summary: { flexDirection: "row", border: "1 solid #d7dee8", marginBottom: 18 },
  summaryItem: { flex: 1, padding: 10, borderRight: "1 solid #e5eaf0" },
  summaryItemLast: { flex: 1, padding: 10 },
  summaryLabel: { fontSize: 8, color: "#64748b", marginBottom: 4, textTransform: "uppercase" },
  summaryValue: { fontSize: 11.5, fontWeight: 700 },
  grid: { flexDirection: "row", gap: 14, marginBottom: 20 },
  party: { flex: 1, border: "1 solid #d7dee8", padding: 12, minHeight: 106 },
  partyHeader: { fontSize: 8, color: "#0f766e", marginBottom: 8, textTransform: "uppercase", fontWeight: 700 },
  partyName: { fontSize: 12, fontWeight: 700, marginBottom: 7 },
  line: { marginBottom: 4, color: "#344052", lineHeight: 1.35 },
  mutedLine: { marginBottom: 4, color: "#5d667a", lineHeight: 1.35 },
  sectionTitle: { fontSize: 9, color: "#64748b", marginBottom: 8, textTransform: "uppercase", fontWeight: 700 },
  table: { border: "1 solid #d7dee8" },
  tableRow: { flexDirection: "row", borderBottom: "1 solid #e5eaf0" },
  tableRowAlt: { backgroundColor: "#f8fafc" },
  tableHeader: { backgroundColor: "#172033", color: "#ffffff", fontWeight: 700 },
  descriptionCell: { flex: 2.6, padding: 8 },
  quantityCell: { flex: 0.7, padding: 8, textAlign: "right" },
  moneyCell: { flex: 1, padding: 8, textAlign: "right" },
  lineTaxCell: { flex: 1.4, padding: 8 },
  taxBreakdown: { marginTop: 14 },
  taxNameCell: { flex: 2.2, padding: 7 },
  taxCell: { flex: 1, padding: 7, textAlign: "right" },
  bottomGrid: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-start", gap: 14, marginTop: 14 },
  paymentBlock: { flex: 1, border: "1 solid #d7dee8", padding: 10, minHeight: 70 },
  paymentName: { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  paymentMeta: { color: "#5d667a", lineHeight: 1.35 },
  paymentAccount: { marginTop: 7, color: "#344052", fontSize: 9.5 },
  totals: { width: 238, border: "1 solid #d7dee8" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", padding: 8, borderBottom: "1 solid #e5eaf0" },
  totalBox: { flexDirection: "row", justifyContent: "space-between", padding: 10, backgroundColor: "#0f766e", color: "#ffffff" },
  total: { fontSize: 13, fontWeight: 700 },
  footer: { marginTop: 18, borderTop: "1 solid #e5eaf0", paddingTop: 8, color: "#5d667a", fontSize: 9, lineHeight: 1.35 },
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

export function InvoicePdfTemplate({ company, customer, documentEyebrow = "Documento comercial", documentTitle = "Factura", dueDate, dueDateLabel = "Vencimiento", issueDate, issueDateLabel = "Emisión", lines, number, payment, showFinancials = true, summaryLabel = "Total", summaryValue, totals }: InvoicePdfInput) {
  const companyName = company.legalName?.trim() || company.name;
  const companyAddress = formatAddress(company);
  const companyContact = [company.email, company.phone, company.website].filter(Boolean).join(" | ");
  const customerAddress = formatAddress(customer);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brandBlock}>
            {company.logoDataUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={company.logoDataUrl} style={styles.logo} />
            ) : (
              <>
                <View style={styles.brandMark} />
                <Text style={styles.brandName}>{companyName}</Text>
                {companyContact ? <Text style={styles.brandMeta}>{companyContact}</Text> : null}
              </>
            )}
          </View>
          <View style={styles.invoiceBlock}>
            <Text style={styles.eyebrow}>{documentEyebrow}</Text>
            <Text style={styles.title}>{documentTitle}</Text>
            <Text style={styles.number}>{number}</Text>
          </View>
        </View>

        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>{issueDateLabel}</Text>
            <Text style={styles.summaryValue}>{issueDate}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>{dueDateLabel}</Text>
            <Text style={styles.summaryValue}>{dueDate ?? "-"}</Text>
          </View>
          <View style={styles.summaryItemLast}>
            <Text style={styles.summaryLabel}>{summaryLabel}</Text>
            <Text style={styles.summaryValue}>{summaryValue ?? totals.totalAmount}</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.party}>
            <Text style={styles.partyHeader}>Emisor</Text>
            <Text style={styles.partyName}>{companyName}</Text>
            {company.vatNumber ? <Text style={styles.line}>{company.vatNumber}</Text> : null}
            {companyAddress ? <Text style={styles.mutedLine}>{companyAddress}</Text> : null}
            {companyContact ? <Text style={styles.mutedLine}>{companyContact}</Text> : null}
          </View>
          <View style={styles.party}>
            <Text style={styles.partyHeader}>Cliente</Text>
            <Text style={styles.partyName}>{customer.name}</Text>
            {customer.number ? <Text style={styles.line}>N.º cliente {customer.number}</Text> : null}
            {customer.taxId ? <Text style={styles.line}>{customer.taxId}</Text> : null}
            {customerAddress ? <Text style={styles.mutedLine}>{customerAddress}</Text> : null}
          </View>
        </View>
        <Text style={styles.sectionTitle}>Detalle</Text>
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={styles.descriptionCell}>Concepto</Text>
            <Text style={styles.quantityCell}>Cantidad</Text>
            {showFinancials ? <Text style={styles.moneyCell}>Precio</Text> : null}
            {showFinancials ? <Text style={styles.lineTaxCell}>Impuestos</Text> : null}
            {showFinancials ? <Text style={styles.moneyCell}>Importe</Text> : null}
          </View>
          {lines.map((line, index) => (
            <View key={`${line.description}-${index}`} style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]}>
              <Text style={styles.descriptionCell}>{line.description}</Text>
              <Text style={styles.quantityCell}>{line.quantity}</Text>
              {showFinancials ? <Text style={styles.moneyCell}>{line.unitPrice}</Text> : null}
              {showFinancials ? <Text style={styles.lineTaxCell}>{line.taxRate}</Text> : null}
              {showFinancials ? <Text style={styles.moneyCell}>{line.lineTotal}</Text> : null}
            </View>
          ))}
        </View>
        {showFinancials && totals.breakdown?.length ? (
          <View style={styles.taxBreakdown} wrap={false}>
            <Text style={styles.sectionTitle}>Desglose de impuestos</Text>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={styles.taxNameCell}>Impuesto</Text>
                <Text style={styles.taxCell}>Base</Text>
                <Text style={styles.taxCell}>Tipo</Text>
                <Text style={styles.taxCell}>Cuota</Text>
              </View>
              {totals.breakdown.map((row, index) => (
                <View key={`${row.name}-${row.rate}-${row.operation}`} style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]}>
                  <Text style={styles.taxNameCell}>{row.name}</Text>
                  <Text style={styles.taxCell}>{row.base}</Text>
                  <Text style={styles.taxCell}>{row.operation === "SUBTRACT" ? "-" : "+"}{row.rate}</Text>
                  <Text style={styles.taxCell}>{row.operation === "SUBTRACT" ? "-" : ""}{row.amount}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {showFinancials ? <View style={styles.bottomGrid} wrap={false}>
          {payment ? (
            <View style={styles.paymentBlock}>
              <Text style={styles.partyHeader}>Forma de pago</Text>
              <Text style={styles.paymentName}>{payment.name}</Text>
              {payment.typeLabel ? <Text style={styles.paymentMeta}>{payment.typeLabel}</Text> : null}
              {payment.bankAccountNumber ? <Text style={styles.paymentAccount}>Cuenta: {payment.bankAccountNumber}</Text> : null}
            </View>
          ) : null}
          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text>Base imponible</Text>
              <Text>{totals.subtotal}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>Impuestos</Text>
              <Text>{totals.taxAmount}</Text>
            </View>
            {totals.hasRetention ? (
              <View style={styles.totalRow}>
                <Text>Retenciones</Text>
                <Text>- {totals.retentionAmount}</Text>
              </View>
            ) : null}
            <View style={styles.totalBox}>
              <Text style={styles.total}>Importe</Text>
              <Text style={styles.total}>{totals.totalAmount}</Text>
            </View>
          </View>
        </View> : null}
        {company.invoiceFooter ? <Text style={styles.footer}>{company.invoiceFooter}</Text> : null}
      </Page>
    </Document>
  );
}
