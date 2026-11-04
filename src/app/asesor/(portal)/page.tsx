import { FilePdf } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

import { AdvisorDownloadButton } from "@/components/advisor/advisor-download-button";
import { AdvisorPeriodBar } from "@/components/advisor/advisor-period-bar";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, MetricCard, PageSection } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { getAdvisorSummary } from "@/server/advisor/data";
import { advisorPeriodQuery } from "@/server/advisor/period";

import { loadPortalPage, type PortalSearchParams } from "./load";

export default async function AdvisorSummaryPage({ searchParams }: { searchParams: PortalSearchParams }) {
  const { context, years, period } = await loadPortalPage(searchParams);
  const company = context.company;
  const address = [company.fiscalAddress, [company.postalCode, company.city].filter(Boolean).join(" "), company.province].filter(Boolean).join(", ");
  if (!period) {
    return <InlineAlert tone="warning">La empresa todavía no tiene ejercicios contables. Cuando empiece a facturar podrás descargar su documentación aquí.</InlineAlert>;
  }
  const scopes = new Set(context.access.scopes);
  const summary = await getAdvisorSummary(company.id, period);
  const money = (value: number) => formatMoney(value, company.baseCurrencyCode);
  const query = advisorPeriodQuery(period);
  const result = Math.round((summary.sales.base - summary.purchases.base) * 100) / 100;
  const vatResult = Math.round((summary.sales.tax - summary.purchases.deductibleTax) * 100) / 100;

  return (
    <>
      <AdvisorPeriodBar action="/asesor" period={period} years={years}>
        <AdvisorDownloadButton href={`/api/advisor/package?${query}`} kind="zip" label="Descargar todo el periodo (ZIP)" pendingLabel="Preparando el ZIP… puede tardar" testId="advisor-full-package" variant="default" />
      </AdvisorPeriodBar>

      <PageSection description="Datos para identificar a la empresa en declaraciones y asientos." title="Empresa">
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Razón social</dt><dd className="font-medium">{company.legalName || company.name}</dd></div>
          <div><dt className="text-xs text-muted-foreground">NIF</dt><dd className="font-mono">{company.vatNumber ?? "—"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Domicilio fiscal</dt><dd>{address || "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Ejercicio</dt><dd className="font-mono">{period.year.code}{period.year.isClosed ? " (cerrado)" : " (abierto)"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Moneda</dt><dd className="font-mono">{company.baseCurrencyCode}</dd></div>
        </dl>
      </PageSection>

      <PageSection description="Mismas cifras que los libros registro de IVA y el modelo 303 del periodo (sin borradores ni anuladas)." title={`Cifras · ${period.period.label}`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard helper={`${summary.sales.count} facturas · IVA ${money(summary.sales.tax)}`} label="Ventas (base)" value={money(summary.sales.base)} />
          <MetricCard helper={`${summary.purchases.count} facturas · IVA deducible ${money(summary.purchases.deductibleTax)}`} label="Gastos (base)" value={money(summary.purchases.base)} />
          <MetricCard helper="Base de ventas − base de gastos" label="Resultado aproximado" tone={result >= 0 ? "success" : "warning"} value={money(result)} />
          <MetricCard helper="IVA repercutido − IVA deducible" label={vatResult >= 0 ? "IVA a ingresar (aprox.)" : "IVA a compensar (aprox.)"} value={money(vatResult)} />
          <MetricCard helper="Retenciones que te practican tus clientes" label="IRPF en ventas" value={money(summary.sales.withholding)} />
          <MetricCard helper="Retenciones practicadas a proveedores (111/115)" label="IRPF en gastos" value={money(summary.purchases.withholding)} />
          <MetricCard label="Total facturado" value={money(summary.sales.total)} />
          <MetricCard label="Total gastos" value={money(summary.purchases.total)} />
        </div>
      </PageSection>

      <PageSection description="Lo que conviene que la empresa resuelva antes de cerrar el periodo." title="Pendientes">
        <ul className="grid gap-1.5 text-sm sm:grid-cols-3">
          <li className="flex items-center justify-between gap-2 rounded-control border border-window-shadow px-2 py-1.5">
            <span>Facturas de venta en borrador</span>
            <StatusBadge tone={summary.pending.draftInvoices > 0 ? "warning" : "success"}>{summary.pending.draftInvoices}</StatusBadge>
          </li>
          <li className="flex items-center justify-between gap-2 rounded-control border border-window-shadow px-2 py-1.5">
            <span>Gastos sin documento adjunto</span>
            <StatusBadge tone={summary.pending.expensesWithoutDocument > 0 ? "warning" : "success"}>{summary.pending.expensesWithoutDocument}</StatusBadge>
          </li>
          <li className="flex items-center justify-between gap-2 rounded-control border border-window-shadow px-2 py-1.5">
            <span>Movimientos bancarios sin conciliar</span>
            <StatusBadge tone={summary.pending.bankUnreconciled > 0 ? "warning" : "success"}>{summary.pending.bankUnreconciled}</StatusBadge>
          </li>
        </ul>
      </PageSection>

      {scopes.has("taxes") ? (
        <PageSection
          actions={<Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/asesor/impuestos?${query}`}>Ver impuestos</Link>}
          description="Modelos preparados por la empresa para este periodo."
          title="Modelos del periodo"
        >
          {summary.reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay modelos preparados para este periodo.</p>
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Modelo</TableHead><TableHead>Periodo</TableHead><TableHead>Plazo</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">PDF</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {summary.reports.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell>{report.name}</TableCell>
                      <TableCell>{report.periodLabel}</TableCell>
                      <TableCell>{report.dueDate ? formatDate(report.dueDate) : "—"}</TableCell>
                      <TableCell><StatusBadge tone={report.status === "FILED" ? "success" : report.status === "READY" ? "info" : "neutral"}>{report.statusLabel}</StatusBadge></TableCell>
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
      ) : null}
    </>
  );
}
