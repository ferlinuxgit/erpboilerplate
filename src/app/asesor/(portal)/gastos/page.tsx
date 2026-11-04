import type { Metadata } from "next";

import { AdvisorDocumentTable } from "@/components/advisor/advisor-document-table";
import { AdvisorDownloadButton } from "@/components/advisor/advisor-download-button";
import { AdvisorPagination, AdvisorSearch } from "@/components/advisor/advisor-list-tools";
import { AdvisorPeriodBar } from "@/components/advisor/advisor-period-bar";
import { InlineAlert, PageSection } from "@/components/ui/page";
import { formatDate, formatMoney } from "@/lib/format";
import { ADVISOR_PAGE_SIZE, listAdvisorExpensesPage } from "@/server/advisor/data";
import { advisorPeriodQuery } from "@/server/advisor/period";

import { loadPortalPage, type PortalSearchParams } from "../load";

export const metadata: Metadata = { title: "Gastos" };

const paymentLabels: Record<string, string> = { PENDING: "Pendiente", PARTIAL: "Parcial", PAID: "Pagada", OVERDUE: "Vencida", VOID: "Anulada" };

export default async function AdvisorExpensesPage({ searchParams }: { searchParams: PortalSearchParams }) {
  const { context, years, period, page, q } = await loadPortalPage(searchParams, "expenses");
  if (!period) return <InlineAlert tone="warning">La empresa todavía no tiene ejercicios contables.</InlineAlert>;
  const list = await listAdvisorExpensesPage(context.company.id, { from: period.from, to: period.to, q, page });
  const money = (value: number, currency = context.company.baseCurrencyCode) => formatMoney(value, currency);
  const query = advisorPeriodQuery(period, { q });

  return (
    <>
      <AdvisorPeriodBar action="/asesor/gastos" period={period} years={years} />
      <PageSection
        actions={
          <>
            <AdvisorDownloadButton href={`/api/advisor/expenses/export?${query}&format=zip`} kind="zip" label={q ? "Resultado: ZIP con documentos" : "Todas: ZIP con documentos"} pendingLabel="Preparando documentos…" testId="advisor-expenses-zip" variant="default" />
            <AdvisorDownloadButton href={`/api/advisor/expenses/export?${query}&format=xlsx`} kind="xlsx" label="Listado Excel" pendingLabel="Preparando Excel…" testId="advisor-expenses-xlsx" />
          </>
        }
        description={`${list.total} facturas recibidas por fecha de factura · total ${money(list.sumTotal)}${q ? ` · búsqueda «${q}»` : ""}. El Excel incluye el desglose por tipo de IVA y cuenta.`}
        title="Facturas recibidas"
      >
        <div className="space-y-2">
          <AdvisorSearch action="/asesor/gastos" periodKey={period.period.key} placeholder="Registro, nº de factura, proveedor o NIF" q={q} yearId={period.year.id} />
          <AdvisorDocumentTable
            columns={[{ label: "Registro" }, { label: "Nº proveedor" }, { label: "Fecha" }, { label: "Proveedor" }, { label: "NIF" }, { label: "Base", numeric: true }, { label: "IVA", numeric: true }, { label: "IRPF", numeric: true }, { label: "Total", numeric: true }, { label: "Pago" }]}
            emptyDescription={q ? "Prueba con otra búsqueda o cambia de periodo." : "No hay facturas recibidas en este periodo."}
            emptyTitle="Sin gastos"
            rows={list.rows.map((row) => ({
              id: row.id,
              cells: [
                row.number,
                row.supplierDocumentNumber ?? "—",
                formatDate(row.issueDate),
                row.supplierName,
                { text: row.supplierTaxId ?? "Sin NIF", tone: row.supplierTaxId ? undefined : "muted" },
                money(row.subtotalAmount, row.currencyCode),
                money(row.taxAmount, row.currencyCode),
                money(row.retentionAmount, row.currencyCode),
                money(row.totalAmount, row.currencyCode),
                { text: paymentLabels[row.paymentStatus] ?? row.paymentStatus, tone: row.paymentStatus === "OVERDUE" ? "danger" : undefined },
              ],
              view: row.documentCount > 0 ? `/api/advisor/expenses/${row.id}/document?view=1` : undefined,
              download: row.documentCount > 0 ? `/api/advisor/expenses/${row.id}/document` : undefined,
              missingLabel: "Sin documento",
            }))}
            selection={{ href: "/api/advisor/expenses/export", body: { year: period.year.id, period: period.period.key }, zipLabel: "ZIP con documentos", noun: "facturas" }}
            testId="advisor-expenses-table"
          />
          <AdvisorPagination action="/asesor/gastos" page={page} pageSize={ADVISOR_PAGE_SIZE} params={{ year: period.year.id, period: period.period.key, ...(q ? { q } : {}) }} total={list.total} />
        </div>
      </PageSection>
    </>
  );
}
