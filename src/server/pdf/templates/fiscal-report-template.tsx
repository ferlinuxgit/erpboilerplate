import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { FiscalSourceDocument, SpanishFiscalSummary } from "@/server/fiscal/spain";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, color: "#111827" },
  title: { fontSize: 20, marginBottom: 6 },
  subtitle: { fontSize: 11, color: "#4b5563", marginBottom: 18 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 13, marginBottom: 8 },
  row: { flexDirection: "row", borderBottom: "1 solid #e5e7eb", paddingVertical: 5 },
  cell: { flex: 1 },
  cellRight: { flex: 1, textAlign: "right" },
  warning: { marginBottom: 4, color: "#92400e" },
});

function money(value: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
}

function date(value: string | null) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function SourceDocumentRows({ documents, title }: { documents: FiscalSourceDocument[]; title: string }) {
  const visibleDocuments = documents.slice(0, 12);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {visibleDocuments.length === 0 ? (
        <Text>Sin documentos en el periodo.</Text>
      ) : (
        visibleDocuments.map((document) => (
          <View style={styles.row} key={document.id}>
            <Text style={styles.cell}>{document.number}</Text>
            <Text style={styles.cell}>{date(document.issueDate)}</Text>
            <Text style={styles.cellRight}>{money(document.taxBase)}</Text>
            <Text style={styles.cellRight}>{money(document.taxAmount)}</Text>
          </View>
        ))
      )}
      {documents.length > visibleDocuments.length ? <Text>Hay más documentos en el export JSON.</Text> : null}
    </View>
  );
}

export function FiscalReportPdfTemplate({
  companyName,
  summary,
}: {
  companyName: string;
  summary: SpanishFiscalSummary;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{summary.modelName}</Text>
        <Text style={styles.subtitle}>{companyName} · Periodo {summary.periodLabel} · Borrador interno</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Resumen</Text>
          <View style={styles.row}>
            <Text style={styles.cell}>Facturas emitidas</Text>
            <Text style={styles.cellRight}>{summary.salesInvoiceCount}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cell}>Facturas proveedor</Text>
            <Text style={styles.cellRight}>{summary.supplierInvoiceCount}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cell}>Base imponible repercutida</Text>
            <Text style={styles.cellRight}>{money(summary.outputTaxBase)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cell}>IVA repercutido</Text>
            <Text style={styles.cellRight}>{money(summary.outputTaxAmount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cell}>IVA soportado</Text>
            <Text style={styles.cellRight}>{money(summary.inputTaxAmount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cell}>Resultado estimado</Text>
            <Text style={styles.cellRight}>{money(summary.settlementAmount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cell}>Retenciones detectadas</Text>
            <Text style={styles.cellRight}>{money(summary.withholdingAmount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cell}>Vencimiento</Text>
            <Text style={styles.cellRight}>{date(summary.dueDate)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Desglose IVA repercutido</Text>
          {summary.buckets.length === 0 ? (
            <Text>No hay líneas facturadas en el periodo.</Text>
          ) : (
            summary.buckets.map((bucket) => (
              <View style={styles.row} key={bucket.rate}>
                <Text style={styles.cell}>Tipo {bucket.rate}%</Text>
                <Text style={styles.cellRight}>{money(bucket.base)}</Text>
                <Text style={styles.cellRight}>{money(bucket.tax)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Desglose IVA soportado</Text>
          {summary.inputBuckets.length === 0 ? (
            <Text>No hay líneas de proveedor con IVA en el periodo.</Text>
          ) : (
            summary.inputBuckets.map((bucket) => (
              <View style={styles.row} key={bucket.rate}>
                <Text style={styles.cell}>Tipo {bucket.rate}%</Text>
                <Text style={styles.cellRight}>{money(bucket.base)}</Text>
                <Text style={styles.cellRight}>{money(bucket.tax)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Retenciones</Text>
          {summary.withholdingBuckets.length === 0 ? (
            <Text>No hay líneas con retención en el periodo.</Text>
          ) : (
            summary.withholdingBuckets.map((bucket) => (
              <View style={styles.row} key={bucket.rate}>
                <Text style={styles.cell}>Tipo {bucket.rate}%</Text>
                <Text style={styles.cellRight}>{money(bucket.base)}</Text>
                <Text style={styles.cellRight}>{money(bucket.tax)}</Text>
              </View>
            ))
          )}
        </View>

        {summary.thirdPartyOperations ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Operaciones Modelo 347</Text>
            {summary.thirdPartyOperations.length === 0 ? (
              <Text>No hay clientes o proveedores por encima de 3.005,06 EUR.</Text>
            ) : (
              summary.thirdPartyOperations.map((operation) => (
                <View style={styles.row} key={`${operation.type}-${operation.taxId}-${operation.name}`}>
                  <Text style={styles.cell}>{operation.type === "customer" ? "Cliente" : "Proveedor"}</Text>
                  <Text style={styles.cell}>{operation.name}</Text>
                  <Text style={styles.cell}>{operation.taxId}</Text>
                  <Text style={styles.cellRight}>{money(operation.amount)}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        <SourceDocumentRows documents={summary.sourceDocuments.salesInvoices} title="Origen IVA repercutido" />
        <SourceDocumentRows documents={summary.sourceDocuments.supplierInvoices} title="Origen IVA soportado" />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Conciliación fiscal-contable</Text>
          <View style={styles.row}>
            <Text style={styles.cell}>IVA repercutido</Text>
            <Text style={styles.cellRight}>{money(summary.accountingReconciliation.outputVat.fiscalAmount)}</Text>
            <Text style={styles.cellRight}>{money(summary.accountingReconciliation.outputVat.accountingAmount)}</Text>
            <Text style={styles.cellRight}>{money(summary.accountingReconciliation.outputVat.difference)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cell}>IVA soportado</Text>
            <Text style={styles.cellRight}>{money(summary.accountingReconciliation.inputVat.fiscalAmount)}</Text>
            <Text style={styles.cellRight}>{money(summary.accountingReconciliation.inputVat.accountingAmount)}</Text>
            <Text style={styles.cellRight}>{money(summary.accountingReconciliation.inputVat.difference)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.cell}>Retenciones</Text>
            <Text style={styles.cellRight}>{money(summary.accountingReconciliation.withholdings.fiscalAmount)}</Text>
            <Text style={styles.cellRight}>{money(summary.accountingReconciliation.withholdings.accountingAmount)}</Text>
            <Text style={styles.cellRight}>{money(summary.accountingReconciliation.withholdings.difference)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Avisos</Text>
          {summary.warnings.map((warning) => (
            <Text key={warning} style={styles.warning}>{warning}</Text>
          ))}
        </View>
      </Page>
    </Document>
  );
}
