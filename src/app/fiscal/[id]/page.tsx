import Link from "next/link";
import { notFound } from "next/navigation";

import { FiscalReportRowActions } from "@/components/fiscal/fiscal-report-row-actions";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { fiscalStatusLabels } from "@/lib/fiscal-spain";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { listFiscalReportsWithSummary } from "@/server/fiscal/service";

const statusTone = { DRAFT: "neutral", READY: "warning", FILED: "success" } as const;

export default async function FiscalReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("fiscal.read");
  const { id } = await params;
  const report = (await listFiscalReportsWithSummary(ctx.company.id)).find((candidate) => candidate.id === id);
  if (!report) notFound();

  const summary = report.summary;
  const canWrite = can(ctx.membership.role, "fiscal.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Fiscalidad · Modelo"
        title={summary?.modelName ?? `Modelo ${report.code}`}
        description={`${summary?.periodLabel ?? report.period} · actualizado ${formatDate(report.updatedAt)}`}
        backHref="/fiscal"
        backLabel="Volver a fiscalidad"
        meta={<StatusBadge tone={statusTone[report.status]}>{fiscalStatusLabels[report.status]}</StatusBadge>}
        actions={<FiscalReportRowActions canWrite={canWrite} hideView report={report} />}
      />

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="IVA repercutido" value={formatMoney(summary?.outputTaxAmount ?? 0, ctx.company.baseCurrencyCode)} helper={`${summary?.salesInvoiceCount ?? 0} facturas emitidas`} />
        <MetricCard label="IVA deducible" value={formatMoney(summary?.deductibleInputTaxAmount ?? 0, ctx.company.baseCurrencyCode)} helper={`${summary?.supplierInvoiceCount ?? 0} facturas recibidas`} />
        <MetricCard label="Resultado" value={formatMoney(summary?.settlementAmount ?? 0, ctx.company.baseCurrencyCode)} helper={(summary?.settlementAmount ?? 0) >= 0 ? "A ingresar" : "A compensar"} tone={(summary?.settlementAmount ?? 0) > 0 ? "warning" : "success"} />
        <MetricCard label="Vencimiento" value={summary?.dueDate ? formatDate(summary.dueDate) : "Sin fecha"} helper={summary?.daysUntilDue === null || summary?.daysUntilDue === undefined ? "No aplicable" : summary.daysUntilDue < 0 ? `${Math.abs(summary.daysUntilDue)} días vencido` : `${summary.daysUntilDue} días restantes`} tone={summary?.dueStatus === "overdue" ? "danger" : summary?.dueStatus === "due-soon" ? "warning" : "neutral"} />
      </section>

      {summary?.warnings.map((warning) => <InlineAlert key={warning} tone="warning">{warning}</InlineAlert>)}

      {summary ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <PageSection title="Desglose de IVA" description="Bases y cuotas por tipo impositivo.">
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader><TableRow><TableHead>Origen</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Cuota</TableHead></TableRow></TableHeader>
                <TableBody>
                  {summary.buckets.map((bucket) => <TableRow key={`out-${bucket.rate}`}><TableCell>Repercutido</TableCell><TableCell>{bucket.rate}%</TableCell><TableCell className="text-right font-mono">{formatMoney(bucket.base, ctx.company.baseCurrencyCode)}</TableCell><TableCell className="text-right font-mono">{formatMoney(bucket.tax, ctx.company.baseCurrencyCode)}</TableCell></TableRow>)}
                  {summary.inputBuckets.map((bucket) => <TableRow key={`in-${bucket.rate}`}><TableCell>Soportado</TableCell><TableCell>{bucket.rate}%</TableCell><TableCell className="text-right font-mono">{formatMoney(bucket.base, ctx.company.baseCurrencyCode)}</TableCell><TableCell className="text-right font-mono">{formatMoney(bucket.tax, ctx.company.baseCurrencyCode)}</TableCell></TableRow>)}
                </TableBody>
              </Table>
            </div>
          </PageSection>

          <PageSection title="Conciliación contable" description="Comparación del cálculo fiscal con las cuentas contables." contentClassName="space-y-3">
            {([
              ["IVA repercutido", summary.accountingReconciliation.outputVat],
              ["IVA soportado", summary.accountingReconciliation.inputVat],
              ["Retenciones", summary.accountingReconciliation.withholdings],
            ] as const).map(([label, line]) => (
              <div className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border p-4" key={label}>
                <div><p className="font-medium">{label}</p><p className="mt-1 text-sm text-muted-foreground">Fiscal {formatMoney(line.fiscalAmount, ctx.company.baseCurrencyCode)} · Contable {formatMoney(line.accountingAmount, ctx.company.baseCurrencyCode)}</p></div>
                <StatusBadge tone={Math.abs(line.difference) < 0.01 ? "success" : "warning"}>{Math.abs(line.difference) < 0.01 ? "Conciliado" : formatMoney(line.difference, ctx.company.baseCurrencyCode)}</StatusBadge>
              </div>
            ))}
          </PageSection>
        </section>
      ) : <InlineAlert tone="danger">No se ha podido calcular el resumen de este modelo.</InlineAlert>}

      {summary ? (
        <PageSection title="Documentos incluidos" description="Facturas que alimentan el cálculo del periodo.">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-2"><p className="text-sm font-medium">Facturas emitidas</p>{summary.sourceDocuments.salesInvoices.length === 0 ? <p className="text-sm text-muted-foreground">No hay facturas emitidas en el periodo.</p> : summary.sourceDocuments.salesInvoices.map((document) => <Link className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-accent" href={`/invoices/${document.id}`} key={document.id}><span><span className="font-medium">{document.number}</span><span className="block text-xs text-muted-foreground">{formatDate(document.issueDate)}</span></span><span className="font-mono font-semibold">{formatMoney(document.totalAmount, ctx.company.baseCurrencyCode)}</span></Link>)}</div>
            <div className="space-y-2"><p className="text-sm font-medium">Facturas recibidas</p>{summary.sourceDocuments.supplierInvoices.length === 0 ? <p className="text-sm text-muted-foreground">No hay facturas recibidas en el periodo.</p> : summary.sourceDocuments.supplierInvoices.map((document) => <Link className="flex items-center justify-between rounded-lg border p-3 text-sm hover:bg-accent" href={`/expenses/${document.id}`} key={document.id}><span><span className="font-medium">{document.number}</span><span className="block text-xs text-muted-foreground">{formatDate(document.issueDate)}</span></span><span className="font-mono font-semibold">{formatMoney(document.totalAmount, ctx.company.baseCurrencyCode)}</span></Link>)}</div>
          </div>
        </PageSection>
      ) : null}
    </PageShell>
  );
}
