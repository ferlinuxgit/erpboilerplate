import type { Metadata } from "next";
import Link from "next/link";

import { ExpenseDocumentRecovery } from "@/components/expenses/expense-document-recovery";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { requireContext } from "@/lib/current-context";
import { listMissingInvoiceDocuments } from "@/server/ocr/document-recovery";

export const metadata: Metadata = { title: "Recuperar documentos de facturas" };

export default async function ExpenseDocumentsRecoveryPage() {
  const ctx = await requireContext("expense.write");
  const missing = await listMissingInvoiceDocuments(ctx.company.id);

  return (
    <PageShell>
      <PageHeader
        title="Recuperar documentos"
        description="Facturas registradas cuyo PDF ya no está en el servidor. Los datos de la factura están intactos: solo falta volver a subir el documento."
        breadcrumbs={[
          { label: "Aprovisionamiento" },
          { label: "Facturas de proveedor", href: "/expenses" },
          { label: "Recuperar documentos" },
        ]}
      />
      <PageSection title="Subir los originales" description="Cada archivo vuelve a su factura si es idéntico al que se subió. Los que no coincidan (otra descarga del mismo documento) se reponen desde la ficha de su factura.">
        <ExpenseDocumentRecovery missingCount={missing.length} />
      </PageSection>
      <PageSection title={`Facturas sin documento (${missing.length})`} description="Se actualiza al recuperar.">
        {missing.length === 0 ? (
          <EmptyState title="No falta ningún documento" description="Todas las facturas registradas tienen su documento disponible." />
        ) : (
          <TableContainer>
            <Table aria-label="Facturas sin documento">
              <TableHeader>
                <TableRow>
                  <TableHead>Registro</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Nº factura proveedor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Archivo original</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {missing.map((document) => (
                  <TableRow key={document.jobId}>
                    <TableCell><Link className="font-mono font-bold text-link hover:underline" href={`/expenses/${document.supplierInvoiceId}`}>{document.invoiceNumber}</Link></TableCell>
                    <TableCell>{formatDate(document.issueDate)}</TableCell>
                    <TableCell>{document.supplierName}</TableCell>
                    <TableCell className="font-mono">{document.supplierDocumentNumber ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(document.totalAmount, ctx.company.baseCurrencyCode)}</TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-xs">{document.fileName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </PageSection>
    </PageShell>
  );
}
