import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 12 },
  title: { fontSize: 20, marginBottom: 12 },
  row: { marginBottom: 6 },
});

export function InvoicePdfTemplate({ amount, customerName, number }: { number: string; customerName: string; amount: string }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Factura {number}</Text>
        <View style={styles.row}><Text>Cliente: {customerName}</Text></View>
        <View style={styles.row}><Text>Importe: {amount}</Text></View>
      </Page>
    </Document>
  );
}
