import { Document, Font, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { InvoicePdfInput } from "@/server/pdf/render";

Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingHorizontal: 42, paddingBottom: 48, fontSize: 9.4, lineHeight: 1.38, color: "#172234", backgroundColor: "#ffffff" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 26 },
  brandBlock: { width: "58%" },
  brandMark: { width: 30, height: 3, backgroundColor: "#087f78", marginBottom: 12 },
  logo: { width: 128, height: 46, objectFit: "contain", marginBottom: 9 },
  brandName: { fontSize: 15, lineHeight: 1.15, fontWeight: 700, marginBottom: 6 },
  brandMeta: { maxWidth: 260, fontSize: 8.5, color: "#657184", lineHeight: 1.45 },
  brandWebsite: { marginTop: 2, fontSize: 8.5, color: "#087f78" },
  invoiceBlock: { width: "38%", alignItems: "flex-end" },
  eyebrow: { fontSize: 7.2, color: "#718096", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1.7 },
  title: { fontSize: 30, lineHeight: 1.05, fontWeight: 700, marginBottom: 6, color: "#101b2c" },
  number: { fontSize: 11.5, color: "#087f78", fontWeight: 700, letterSpacing: 0.35 },
  summary: { flexDirection: "row", alignItems: "center", backgroundColor: "#f3f6f7", borderTop: "3 solid #087f78", paddingVertical: 13, paddingHorizontal: 15, marginBottom: 18 },
  summaryItem: { width: "25%", paddingRight: 12 },
  summaryItemDue: { width: "25%", paddingHorizontal: 12, borderLeft: "1 solid #d8e0e5" },
  summaryItemTotal: { flex: 1, paddingLeft: 18, borderLeft: "1 solid #d8e0e5", alignItems: "flex-end" },
  summaryLabel: { fontSize: 6.9, color: "#758193", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1.15 },
  summaryValue: { fontSize: 11.5, fontWeight: 700, color: "#172234" },
  summaryTotal: { fontSize: 16, fontWeight: 700, color: "#101b2c" },
  grid: { flexDirection: "row", gap: 12, marginBottom: 22 },
  party: { flex: 1, backgroundColor: "#f7f9fa", paddingVertical: 13, paddingHorizontal: 14, minHeight: 108 },
  partyCustomer: { borderLeft: "3 solid #087f78", paddingLeft: 13 },
  partyHeader: { fontSize: 6.9, color: "#087f78", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 700 },
  partyName: { fontSize: 11.5, lineHeight: 1.25, fontWeight: 700, marginBottom: 6, color: "#172234" },
  line: { marginBottom: 3, color: "#354255" },
  mutedLine: { marginBottom: 3, color: "#657184" },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 8 },
  sectionTitle: { fontSize: 7.2, color: "#526174", textTransform: "uppercase", letterSpacing: 1.35, fontWeight: 700 },
  sectionRule: { flex: 1, height: 1, backgroundColor: "#d9e0e5" },
  table: { borderTop: "1 solid #172234" },
  tableRow: { flexDirection: "row", alignItems: "flex-start", borderBottom: "1 solid #dfe5e9" },
  tableRowAlt: { backgroundColor: "#fafbfb" },
  tableHeader: { backgroundColor: "#142034", color: "#ffffff", fontWeight: 700, borderBottom: "0 solid transparent" },
  tableHeaderText: { fontSize: 7.1, textTransform: "uppercase", letterSpacing: 0.55 },
  descriptionCell: { flex: 2.8, paddingVertical: 9, paddingHorizontal: 9 },
  quantityCell: { flex: 0.65, paddingVertical: 9, paddingHorizontal: 7, textAlign: "right" },
  moneyCell: { flex: 1, paddingVertical: 9, paddingHorizontal: 8, textAlign: "right" },
  lineTaxCell: { flex: 1.45, paddingVertical: 9, paddingHorizontal: 8, color: "#087f78", fontSize: 8.4, lineHeight: 1.32 },
  lineTaxHeaderCell: { color: "#ffffff" },
  taxBreakdown: { marginTop: 16 },
  compactTable: { borderTop: "1 solid #b9c5cc" },
  compactHeader: { backgroundColor: "#edf2f3", color: "#364457", fontWeight: 700 },
  taxNameCell: { flex: 2.2, paddingVertical: 7, paddingHorizontal: 9 },
  taxCell: { flex: 1, paddingVertical: 7, paddingHorizontal: 9, textAlign: "right" },
  bottomGrid: { flexDirection: "row", justifyContent: "flex-end", alignItems: "stretch", gap: 14, marginTop: 16 },
  paymentBlock: { flex: 1, backgroundColor: "#f0f7f6", borderLeft: "3 solid #087f78", paddingVertical: 10, paddingHorizontal: 13, minHeight: 86 },
  paymentName: { fontSize: 11, lineHeight: 1.25, fontWeight: 700, marginBottom: 4, color: "#172234" },
  paymentMeta: { color: "#657184" },
  paymentAccountLabel: { marginTop: 8, marginBottom: 2, fontSize: 6.8, color: "#758193", textTransform: "uppercase", letterSpacing: 1 },
  paymentAccount: { color: "#243247", fontSize: 9.2, letterSpacing: 0.35 },
  totals: { width: 226 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, paddingHorizontal: 10, borderBottom: "1 solid #dfe5e9", color: "#465468" },
  totalRowValue: { color: "#172234", fontWeight: 700 },
  totalBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3, paddingVertical: 9, paddingHorizontal: 11, backgroundColor: "#142034", color: "#ffffff" },
  totalLabel: { fontSize: 7.2, textTransform: "uppercase", letterSpacing: 1.1 },
  total: { fontSize: 14.5, fontWeight: 700 },
  pageFooter: { position: "absolute", bottom: 18, left: 42, right: 42, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingTop: 6, borderTop: "1 solid #dfe5e9", color: "#7b8797", fontSize: 6.8, lineHeight: 1.25, letterSpacing: 0.2 },
  pageFooterCopy: { width: "82%" },
  pageFooterNumber: { width: "18%", minHeight: 9, textAlign: "right" },
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

function SectionHeading({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeading} minPresenceAhead={24}>
      <Text style={styles.sectionTitle}>{label}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

export function InvoicePdfTemplate({ company, customer, documentEyebrow = "Documento comercial", documentTitle = "Factura", dueDate, dueDateLabel = "Vencimiento", issueDate, issueDateLabel = "Emisión", lines, number, payment, showFinancials = true, summaryLabel = "Total", summaryValue, totals }: InvoicePdfInput) {
  const companyName = company.legalName?.trim() || company.name;
  const companyAddress = formatAddress(company);
  const companyContact = [company.email, company.phone].filter(Boolean).join("  |  ");
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
              </>
            )}
            {companyContact ? <Text style={styles.brandMeta}>{companyContact}</Text> : null}
            {company.website ? <Text style={styles.brandWebsite}>{company.website}</Text> : null}
          </View>
          <View style={styles.invoiceBlock}>
            <Text style={styles.eyebrow}>{documentEyebrow}</Text>
            <Text style={styles.title}>{documentTitle}</Text>
            <Text style={styles.number}>{number}</Text>
          </View>
        </View>

        <View style={styles.summary} wrap={false}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>{issueDateLabel}</Text>
            <Text style={styles.summaryValue}>{issueDate}</Text>
          </View>
          <View style={styles.summaryItemDue}>
            <Text style={styles.summaryLabel}>{dueDateLabel}</Text>
            <Text style={styles.summaryValue}>{dueDate ?? "Sin vencimiento"}</Text>
          </View>
          <View style={styles.summaryItemTotal}>
            <Text style={styles.summaryLabel}>{summaryLabel}</Text>
            <Text style={styles.summaryTotal}>{summaryValue ?? totals.totalAmount}</Text>
          </View>
        </View>

        <View style={styles.grid} wrap={false}>
          <View style={styles.party}>
            <Text style={styles.partyHeader}>Emisor</Text>
            <Text style={styles.partyName}>{companyName}</Text>
            {company.vatNumber ? <Text style={styles.line}>{company.vatNumber}</Text> : null}
            {companyAddress ? <Text style={styles.mutedLine}>{companyAddress}</Text> : null}
            {companyContact ? <Text style={styles.mutedLine}>{companyContact}</Text> : null}
          </View>
          <View style={[styles.party, styles.partyCustomer]}>
            <Text style={styles.partyHeader}>Cliente</Text>
            <Text style={styles.partyName}>{customer.name}</Text>
            {customer.number ? <Text style={styles.line}>N.º cliente {customer.number}</Text> : null}
            {customer.taxId ? <Text style={styles.line}>{customer.taxId}</Text> : null}
            {customerAddress ? <Text style={styles.mutedLine}>{customerAddress}</Text> : null}
          </View>
        </View>
        <SectionHeading label="Detalle" />
        <View style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeader]}>
            <Text style={[styles.descriptionCell, styles.tableHeaderText]}>Concepto</Text>
            <Text style={[styles.quantityCell, styles.tableHeaderText]}>Cantidad</Text>
            {showFinancials ? <Text style={[styles.moneyCell, styles.tableHeaderText]}>Precio</Text> : null}
            {showFinancials ? <Text style={[styles.lineTaxCell, styles.tableHeaderText, styles.lineTaxHeaderCell]}>Impuestos</Text> : null}
            {showFinancials ? <Text style={[styles.moneyCell, styles.tableHeaderText]}>Importe</Text> : null}
          </View>
          {lines.map((line, index) => (
            <View key={`${line.description}-${index}`} style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
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
            <SectionHeading label="Desglose de impuestos" />
            <View style={styles.compactTable}>
              <View style={[styles.tableRow, styles.compactHeader]}>
                <Text style={[styles.taxNameCell, styles.tableHeaderText]}>Impuesto</Text>
                <Text style={[styles.taxCell, styles.tableHeaderText]}>Base</Text>
                <Text style={[styles.taxCell, styles.tableHeaderText]}>Tipo</Text>
                <Text style={[styles.taxCell, styles.tableHeaderText]}>Cuota</Text>
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
              {payment.bankAccountNumber ? (
                <>
                  <Text style={styles.paymentAccountLabel}>Cuenta de abono</Text>
                  <Text style={styles.paymentAccount}>{payment.bankAccountNumber}</Text>
                </>
              ) : null}
            </View>
          ) : null}
          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text>Base imponible</Text>
              <Text style={styles.totalRowValue}>{totals.subtotal}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>Impuestos</Text>
              <Text style={styles.totalRowValue}>{totals.taxAmount}</Text>
            </View>
            {totals.hasRetention ? (
              <View style={styles.totalRow}>
                <Text>Retenciones</Text>
                <Text style={styles.totalRowValue}>- {totals.retentionAmount}</Text>
              </View>
            ) : null}
            <View style={styles.totalBox}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.total}>{totals.totalAmount}</Text>
            </View>
          </View>
        </View> : null}
        <View style={styles.pageFooter} fixed>
          <Text style={styles.pageFooterCopy}>{company.invoiceFooter || companyName}</Text>
          <Text fixed style={styles.pageFooterNumber} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
