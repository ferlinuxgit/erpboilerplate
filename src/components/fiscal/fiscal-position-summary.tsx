import Link from "next/link";

import { HelpTerm } from "@/components/help/help-term";
import { EmptyState, MetricCard } from "@/components/ui/page";
import { formatDate, formatMoney } from "@/lib/format";
import { describeDaysUntil } from "@/lib/pluralize";
import { fiscalRegimeLabels, statusLabel, taxPeriodicityLabels, verifactuModeLabels } from "@/lib/status-labels";
import type { FiscalReportWithSummary } from "@/server/fiscal/service";

type FiscalPositionSummaryProps = {
  reports: FiscalReportWithSummary[];
  profile: { fiscalRegime: string; taxPeriodicity: string; prorrataPct: number; verifactuMode: string; taxpayerType: string };
  currencyCode: string;
};

/**
 * Posición fiscal compacta para /fiscal: el último 303 (o el último modelo) con sus importes
 * clave y el perfil fiscal en una línea. El detalle por casillas vive en /fiscal/{id}.
 */
export function FiscalPositionSummary({ currencyCode, profile, reports }: FiscalPositionSummaryProps) {
  const report = reports.find((candidate) => candidate.code === "303" && candidate.summary) ?? reports.find((candidate) => candidate.summary) ?? null;
  const summary = report?.summary ?? null;
  const money = (value: number) => formatMoney(value, currencyCode);

  return (
    <div className="space-y-3">
      {summary && report ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            href={`/fiscal/${report.id}`}
            label={`${summary.modelName} · ${summary.periodLabel}`}
            value={money(summary.settlementAmount)}
            helper={summary.settlementAmount > 0 ? "A ingresar (resultado estimado)" : "A compensar o devolver"}
            tone={summary.settlementAmount > 0 ? "warning" : "success"}
          />
          <MetricCard label="IVA de tus facturas" value={money(summary.outputTaxAmount)} helper={`${summary.salesInvoiceCount} ${summary.salesInvoiceCount === 1 ? "factura emitida" : "facturas emitidas"}`} />
          <MetricCard label="IVA deducible de tus gastos" value={money(summary.deductibleInputTaxAmount)} helper={`${summary.supplierInvoiceCount} ${summary.supplierInvoiceCount === 1 ? "factura recibida" : "facturas recibidas"}`} />
          <MetricCard
            label="Vencimiento"
            value={summary.dueDate ? formatDate(summary.dueDate) : "Sin fecha"}
            helper={report.status === "FILED" ? "Presentado" : summary.daysUntilDue === null ? "No aplicable" : describeDaysUntil(summary.daysUntilDue)}
            tone={report.status === "FILED" ? "success" : summary.dueStatus === "overdue" ? "danger" : summary.dueStatus === "due-soon" ? "warning" : "neutral"}
          />
        </div>
      ) : (
        <EmptyState title="Sin borradores todavía" description="Prepara el primer modelo desde «Qué tengo que presentar» para ver aquí el IVA a ingresar o compensar." />
      )}
      <p className="text-xs text-muted-foreground">
        Perfil: {profile.taxpayerType === "individual" ? "autónomo" : "sociedad"} · IVA {statusLabel(fiscalRegimeLabels, profile.fiscalRegime).toLowerCase()} · {statusLabel(taxPeriodicityLabels, profile.taxPeriodicity).toLowerCase()} ·{" "}
        <HelpTerm term="prorrata">prorrata</HelpTerm> {profile.prorrataPct} % · <HelpTerm term="verifactu">VERI*FACTU</HelpTerm>: {statusLabel(verifactuModeLabels, profile.verifactuMode)}.{" "}
        <Link className="link" href="/fiscal/settings">Cambiar perfil fiscal</Link>
      </p>
    </div>
  );
}
