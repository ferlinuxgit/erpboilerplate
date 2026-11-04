import { FilePdf } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

import { AdvisorDownloadList } from "@/components/advisor/advisor-download-list";
import { AdvisorPeriodBar } from "@/components/advisor/advisor-period-bar";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, PageSection } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { listAdvisorFiscalReports } from "@/server/advisor/data";
import { advisorPeriodQuery } from "@/server/advisor/period";

import { loadPortalPage, type PortalSearchParams } from "../load";

export const metadata: Metadata = { title: "Impuestos" };

export default async function AdvisorTaxesPage({ searchParams }: { searchParams: PortalSearchParams }) {
  const { context, years, period } = await loadPortalPage(searchParams, "taxes");
  if (!period) return <InlineAlert tone="warning">La empresa todavía no tiene ejercicios contables.</InlineAlert>;
  const query = advisorPeriodQuery(period);
  // Modelos de todo el ejercicio (trimestrales y anuales), para ver de un vistazo qué está presentado.
  const yearRange = { from: period.year.startsAt, toExclusive: new Date(Date.UTC(period.year.endsAt.getUTCFullYear(), period.year.endsAt.getUTCMonth(), period.year.endsAt.getUTCDate() + 1)) };
  const reports = await listAdvisorFiscalReports(context.company.id, yearRange);
  return (
    <>
      <AdvisorPeriodBar action="/asesor/impuestos" period={period} years={years} />
      <PageSection description="Con los mismos importes que el modelo 303 del periodo (sin borradores ni anuladas)." title={`Libros registro de IVA · ${period.period.label}`}>
        <AdvisorDownloadList
          items={[
            { key: "iva-expedidas", title: "Facturas expedidas", description: "Fecha, número, cliente, NIF, tipo de operación, base, cuota, retención y total.", href: `/api/advisor/books/iva-expedidas?${query}`, kind: "xlsx" },
            { key: "iva-recibidas", title: "Facturas recibidas", description: "Fecha de factura y de registro, proveedor, NIF, base, IVA soportado y deducible, retención y total.", href: `/api/advisor/books/iva-recibidas?${query}`, kind: "xlsx" },
          ]}
          testId="advisor-vat-books"
        />
      </PageSection>
      <PageSection description="Modelos preparados por la empresa en el ejercicio, con su plazo y el justificante si ya se presentaron." title={`Modelos · ejercicio ${period.year.code}`}>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">La empresa no ha preparado modelos en este ejercicio. Puedes pedírselos o calcularlos con los libros registro.</p>
        ) : (
          <TableContainer>
            <Table data-testid="advisor-fiscal-reports">
              <TableHeader>
                <TableRow><TableHead>Modelo</TableHead><TableHead>Periodo</TableHead><TableHead>Plazo</TableHead><TableHead>Estado</TableHead><TableHead>Presentado</TableHead><TableHead>Justificante</TableHead><TableHead className="text-right">PDF</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell className="font-bold">{report.name}</TableCell>
                    <TableCell>{report.periodLabel}</TableCell>
                    <TableCell>{report.dueDate ? formatDate(report.dueDate) : "—"}</TableCell>
                    <TableCell><StatusBadge tone={report.status === "FILED" ? "success" : report.status === "READY" ? "info" : "neutral"}>{report.statusLabel}</StatusBadge></TableCell>
                    <TableCell>{report.filedAt ? formatDate(report.filedAt) : "—"}</TableCell>
                    <TableCell className="font-mono">{report.filingReceiptNumber ?? "—"}{report.paymentNrc ? ` · NRC ${report.paymentNrc}` : ""}</TableCell>
                    <TableCell className="text-right">
                      <a className={buttonVariants({ variant: "ghost", size: "sm" })} download href={`/api/advisor/fiscal-reports/${report.id}/pdf`}>
                        <FilePdf aria-hidden="true" />
                        PDF
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </PageSection>
    </>
  );
}
