import type { Metadata } from "next";

import { AdvisorDocumentTable } from "@/components/advisor/advisor-document-table";
import { AdvisorDownloadButton } from "@/components/advisor/advisor-download-button";
import { AdvisorPagination, AdvisorSearch } from "@/components/advisor/advisor-list-tools";
import { AdvisorPeriodBar } from "@/components/advisor/advisor-period-bar";
import { InlineAlert, PageSection } from "@/components/ui/page";
import { formatDate, formatMoney } from "@/lib/format";
import { ADVISOR_PAGE_SIZE, listAdvisorSalesPage } from "@/server/advisor/data";
import { advisorPeriodQuery } from "@/server/advisor/period";

import { loadPortalPage, type PortalSearchParams } from "../load";

export const metadata: Metadata = { title: "Ventas" };

const paymentLabels: Record<string, string> = { PENDING: "Pendiente", PARTIAL: "Parcial", PAID: "Cobrada", OVERDUE: "Vencida", VOID: "Anulada" };

export default async function AdvisorSalesPage({ searchParams }: { searchParams: PortalSearchParams }) {
  const { context, years, period, page, q } = await loadPortalPage(searchParams, "sales");
  if (!period) return <InlineAlert tone="warning">La empresa todavía no tiene ejercicios contables.</InlineAlert>;
  const currency = context.company.baseCurrencyCode;
  const money = (value: number) => formatMoney(value, currency);
  const list = await listAdvisorSalesPage(context.company.id, { from: period.from, to: period.to, q, page });
  const query = advisorPeriodQuery(period, { q });

  return (
    <>
      <AdvisorPeriodBar action="/asesor/ventas" period={period} years={years} />
      <PageSection
        actions={
          <>
            <AdvisorDownloadButton href={`/api/advisor/sales/export?${query}&format=zip`} kind="zip" label={q ? "Resultado: ZIP con PDF" : "Todas: ZIP con PDF"} pendingLabel="Preparando PDF…" testId="advisor-sales-zip" variant="default" />
            <AdvisorDownloadButton href={`/api/advisor/sales/export?${query}&format=xlsx`} kind="xlsx" label="Listado Excel" pendingLabel="Preparando Excel…" testId="advisor-sales-xlsx" />
          </>
        }
        description={`${list.total} facturas emitidas y rectificativas · total ${money(list.sumTotal)}${q ? ` · búsqueda «${q}»` : ""}. Sin borradores.`}
        title="Facturas emitidas"
      >
        <div className="space-y-2">
          <AdvisorSearch action="/asesor/ventas" periodKey={period.period.key} placeholder="Número, cliente, NIF o importe" q={q} yearId={period.year.id} />
          <AdvisorDocumentTable
            columns={[{ label: "Número" }, { label: "Fecha" }, { label: "Cliente" }, { label: "NIF" }, { label: "Base", numeric: true }, { label: "IVA", numeric: true }, { label: "IRPF", numeric: true }, { label: "Total", numeric: true }, { label: "Cobro" }]}
            emptyDescription={q ? "Prueba con otra búsqueda o cambia de periodo." : "No hay facturas emitidas en este periodo."}
            emptyTitle="Sin facturas"
            rows={list.rows.map((row) => ({
              id: row.id,
              cells: [
                row.invoiceType === "CREDIT_NOTE" ? `${row.number} (rectif.${row.rectifiedNumber ? ` de ${row.rectifiedNumber}` : ""})` : row.number,
                formatDate(row.issueDate),
                row.customerName,
                { text: row.customerTaxId ?? "Sin NIF", tone: row.customerTaxId ? undefined : "muted" },
                money(row.subtotal),
                money(row.taxAmount),
                money(row.retentionAmount),
                money(row.totalAmount),
                { text: paymentLabels[row.paymentStatus] ?? row.paymentStatus, tone: row.paymentStatus === "OVERDUE" ? "danger" : row.paymentStatus === "VOID" ? "muted" : undefined },
              ],
              view: `/api/advisor/sales/${row.id}/pdf?view=1`,
              download: `/api/advisor/sales/${row.id}/pdf`,
            }))}
            selection={{ href: "/api/advisor/sales/export", body: { year: period.year.id, period: period.period.key }, zipLabel: "ZIP con PDF", noun: "facturas" }}
            testId="advisor-sales-table"
          />
          <AdvisorPagination action="/asesor/ventas" page={page} pageSize={ADVISOR_PAGE_SIZE} params={{ year: period.year.id, period: period.period.key, ...(q ? { q } : {}) }} total={list.total} />
        </div>
      </PageSection>
    </>
  );
}
