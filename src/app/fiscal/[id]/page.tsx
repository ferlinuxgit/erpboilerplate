import Link from "next/link";
import { notFound } from "next/navigation";

import { FiscalReportRowActions } from "@/components/fiscal/fiscal-report-row-actions";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { fiscalStatusLabels, getSpanishFiscalModel } from "@/lib/fiscal-spain";
import { modelo349KeyLabels } from "@/server/fiscal/spain-calc";
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
  const currency = ctx.company.baseCurrencyCode;
  const model = getSpanishFiscalModel(report.code);
  const box130 = (code: string) => summary?.modelo130?.boxes.find((box) => box.box === code)?.amount ?? 0;
  const dueHelper = summary?.daysUntilDue === null || summary?.daysUntilDue === undefined ? "No aplicable" : summary.daysUntilDue < 0 ? `${Math.abs(summary.daysUntilDue)} días vencido` : `${summary.daysUntilDue} días restantes`;
  const dueTone = summary?.dueStatus === "overdue" ? "danger" as const : summary?.dueStatus === "due-soon" ? "warning" as const : "neutral" as const;

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

      {model ? <p className="text-sm text-muted-foreground">{model.plainHelp}</p> : null}

      {summary?.modelo130 ? (
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Ingresos del año (01)" value={formatMoney(box130("01"), currency)} helper="Bases de tus facturas emitidas desde el 1 de enero" />
          <MetricCard label="Gastos del año (02)" value={formatMoney(box130("02"), currency)} helper="Facturas recibidas deducibles" />
          <MetricCard label="Resultado (19)" value={formatMoney(summary.modelo130.resultCents / 100, currency)} helper={summary.modelo130.resultCents > 0 ? "A ingresar" : summary.modelo130.resultCents < 0 ? "Negativo: se descuenta el próximo trimestre" : "Sin pago"} tone={summary.modelo130.resultCents > 0 ? "warning" : "success"} />
          <MetricCard label="Vencimiento" value={summary.dueDate ? formatDate(summary.dueDate) : "Sin fecha"} helper={dueHelper} tone={dueTone} />
        </section>
      ) : summary?.modelo349 ? (
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Operadores" value={summary.modelo349.operatorCount} helper="Clientes y proveedores de la UE a declarar" />
          <MetricCard label="Importe total" value={formatMoney(summary.modelo349.totalAmount, currency)} helper="Suma de bases (no se paga nada)" />
          <MetricCard label="Rectificaciones" value={formatMoney(summary.modelo349.rectificationAmount, currency)} helper="De periodos anteriores" />
          <MetricCard label="Vencimiento" value={summary.dueDate ? formatDate(summary.dueDate) : "Sin fecha"} helper={dueHelper} tone={dueTone} />
        </section>
      ) : (
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="IVA devengado (27)" value={formatMoney(summary?.outputTaxAmount ?? 0, ctx.company.baseCurrencyCode)} helper={`${summary?.salesInvoiceCount ?? 0} facturas emitidas · incluye recargo y autorepercusiones`} />
        <MetricCard label="IVA deducible (45)" value={formatMoney(summary?.deductibleInputTaxAmount ?? 0, ctx.company.baseCurrencyCode)} helper={`${summary?.supplierInvoiceCount ?? 0} facturas recibidas`} />
        <MetricCard label="Resultado (46)" value={formatMoney(summary?.settlementAmount ?? 0, ctx.company.baseCurrencyCode)} helper={(summary?.settlementAmount ?? 0) >= 0 ? "A ingresar" : "A compensar"} tone={(summary?.settlementAmount ?? 0) > 0 ? "warning" : "success"} />
        <MetricCard label="Vencimiento" value={summary?.dueDate ? formatDate(summary.dueDate) : "Sin fecha"} helper={summary?.daysUntilDue === null || summary?.daysUntilDue === undefined ? "No aplicable" : summary.daysUntilDue < 0 ? `${Math.abs(summary.daysUntilDue)} días vencido` : `${summary.daysUntilDue} días restantes`} tone={summary?.dueStatus === "overdue" ? "danger" : summary?.dueStatus === "due-soon" ? "warning" : "neutral"} />
      </section>
      )}

      {summary?.warnings.map((warning) => <InlineAlert key={warning} tone="warning">{warning}</InlineAlert>)}

      {summary?.modelo130 ? (
        <PageSection title="Casillas del modelo 130" description="Cálculo acumulado desde el 1 de enero. Copia estos importes en la sede electrónica de la AEAT.">
          <div className="overflow-x-auto rounded-[2px] border">
            <Table>
              <TableHeader><TableRow><TableHead>Casilla</TableHead><TableHead>Concepto</TableHead><TableHead className="text-right">Importe</TableHead></TableRow></TableHeader>
              <TableBody>
                {summary.modelo130.boxes.map((box) => (
                  <TableRow key={box.box}>
                    <TableCell className="font-mono">{box.box}</TableCell>
                    <TableCell className={box.kind === "settlement" ? "font-semibold" : undefined}>{box.label}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(box.amount, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </PageSection>
      ) : null}

      {summary?.modelo349 ? (
        <PageSection title="Operadores intracomunitarios" description="Un registro por NIF-IVA y clave. E: ventas de bienes · S: servicios prestados · A: compras de bienes · I: servicios recibidos.">
          {summary.modelo349.operators.length === 0 && summary.modelo349.rectifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay operaciones intracomunitarias en el periodo: no tienes que presentar el 349.</p>
          ) : (
            <div className="overflow-x-auto rounded-[2px] border">
              <Table>
                <TableHeader><TableRow><TableHead>Clave</TableHead><TableHead>NIF-IVA</TableHead><TableHead>Nombre</TableHead><TableHead>Periodo rectificado</TableHead><TableHead className="text-right">Base</TableHead></TableRow></TableHeader>
                <TableBody>
                  {summary.modelo349.operators.map((operator) => (
                    <TableRow key={`${operator.key}-${operator.taxId}`}>
                      <TableCell className="font-mono" title={modelo349KeyLabels[operator.key]}>{operator.key}</TableCell>
                      <TableCell className="font-mono">{operator.taxId}</TableCell>
                      <TableCell>{operator.name}</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(operator.amount, currency)}</TableCell>
                    </TableRow>
                  ))}
                  {summary.modelo349.rectifications.map((operator) => (
                    <TableRow key={`r-${operator.key}-${operator.taxId}-${operator.originalPeriod}`}>
                      <TableCell className="font-mono">{operator.key}</TableCell>
                      <TableCell className="font-mono">{operator.taxId}</TableCell>
                      <TableCell>{operator.name}</TableCell>
                      <TableCell>{operator.originalPeriod}</TableCell>
                      <TableCell className="text-right font-mono">{formatMoney(operator.amount, currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </PageSection>
      ) : null}

      {summary && !summary.modelo130 && !summary.modelo349 ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <PageSection title="Desglose de IVA" description="Bases y cuotas por tipo. El soportado muestra la cuota íntegra, antes de prorrata.">
            <div className="overflow-x-auto rounded-[2px] border">
              <Table>
                <TableHeader><TableRow><TableHead>Origen</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Cuota</TableHead></TableRow></TableHeader>
                <TableBody>
                  {summary.buckets.map((bucket) => <TableRow key={`out-${bucket.rate}`}><TableCell>Repercutido</TableCell><TableCell>{bucket.rate}%</TableCell><TableCell className="text-right font-mono">{formatMoney(bucket.base, ctx.company.baseCurrencyCode)}</TableCell><TableCell className="text-right font-mono">{formatMoney(bucket.tax, ctx.company.baseCurrencyCode)}</TableCell></TableRow>)}
                  {summary.surchargeBuckets.map((bucket) => <TableRow key={`re-${bucket.rate}`}><TableCell>Recargo equivalencia</TableCell><TableCell>{bucket.rate}%</TableCell><TableCell className="text-right font-mono">{formatMoney(bucket.base, ctx.company.baseCurrencyCode)}</TableCell><TableCell className="text-right font-mono">{formatMoney(bucket.tax, ctx.company.baseCurrencyCode)}</TableCell></TableRow>)}
                  {summary.inputBuckets.map((bucket) => <TableRow key={`in-${bucket.rate}`}><TableCell>Soportado</TableCell><TableCell>{bucket.rate}%</TableCell><TableCell className="text-right font-mono">{formatMoney(bucket.base, ctx.company.baseCurrencyCode)}</TableCell><TableCell className="text-right font-mono">{formatMoney(bucket.tax, ctx.company.baseCurrencyCode)}</TableCell></TableRow>)}
                </TableBody>
              </Table>
            </div>
          </PageSection>

          <PageSection title="Conciliación contable" description="Si algo no cuadra, revisa asientos manuales en esas cuentas o documentos anulados en otro periodo." contentClassName="space-y-3">
            {([
              ["IVA devengado (477)", summary.accountingReconciliation.outputVat],
              ["IVA deducible (472)", summary.accountingReconciliation.inputVat],
              ["Retenciones practicadas (4751)", summary.accountingReconciliation.withholdings],
              ["Retenciones soportadas (473)", summary.accountingReconciliation.salesWithholdings],
            ] as const).map(([label, line]) => (
              <div className="grid grid-cols-[1fr_auto] gap-3 rounded-[2px] border p-3" key={label}>
                <div><p className="font-medium">{label}</p><p className="mt-1 text-sm text-muted-foreground">Fiscal {formatMoney(line.fiscalAmount, ctx.company.baseCurrencyCode)} · Contable {formatMoney(line.accountingAmount, ctx.company.baseCurrencyCode)}</p></div>
                <StatusBadge tone={Math.abs(line.difference) < 0.01 ? "success" : "warning"}>{Math.abs(line.difference) < 0.01 ? "Conciliado" : formatMoney(line.difference, ctx.company.baseCurrencyCode)}</StatusBadge>
              </div>
            ))}
          </PageSection>
        </section>
      ) : summary ? null : <InlineAlert tone="danger">No se ha podido calcular el resumen de este modelo.</InlineAlert>}

      {summary && summary.code === "303" ? (
        <PageSection title="Casillas del modelo 303" description="Borrador por casillas según el diseño vigente de la AEAT. Revísalas antes de copiarlas en la sede electrónica.">
          <div className="overflow-x-auto rounded-[2px] border">
            <Table>
              <TableHeader><TableRow><TableHead>Casilla</TableHead><TableHead>Concepto</TableHead><TableHead className="text-right">Importe</TableHead></TableRow></TableHeader>
              <TableBody>
                {summary.modelo303Boxes.map((box) => (
                  <TableRow key={`${box.box}-${box.label}`}>
                    <TableCell className="font-mono">{box.box === "REV" || box.box === "EXE" ? "Revisar" : box.box}</TableCell>
                    <TableCell className={box.kind === "settlement" ? "font-semibold" : undefined}>{box.label}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(box.amount, ctx.company.baseCurrencyCode)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </PageSection>
      ) : null}

      {summary && summary.automationChecks.some((check) => check.status !== "ok") ? (
        <PageSection title="Revisiones antes de presentar" description="Avisos detectados automáticamente en el cálculo.">
          <div className="space-y-2">
            {summary.automationChecks.filter((check) => check.status !== "ok").map((check) => (
              <InlineAlert key={check.code} title={check.title} tone={check.status === "blocking" ? "danger" : "warning"}>
                <p>{check.detail}</p>
                <p className="mt-1">{check.action}</p>
              </InlineAlert>
            ))}
          </div>
        </PageSection>
      ) : null}

      {summary ? (
        <PageSection title="Documentos incluidos" description="Facturas que alimentan el cálculo del periodo.">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2"><p className="text-sm font-medium">Facturas emitidas</p>{summary.sourceDocuments.salesInvoices.length === 0 ? <p className="text-sm text-muted-foreground">No hay facturas emitidas en el periodo.</p> : summary.sourceDocuments.salesInvoices.map((document) => <Link className="flex items-center justify-between rounded-[2px] border p-3 text-sm hover:bg-accent" href={`/invoices/${document.id}`} key={document.id}><span><span className="font-medium">{document.number}</span><span className="block text-xs text-muted-foreground">{formatDate(document.issueDate)}</span></span><span className="font-mono font-semibold">{formatMoney(document.totalAmount, ctx.company.baseCurrencyCode)}</span></Link>)}</div>
            <div className="space-y-2"><p className="text-sm font-medium">Facturas recibidas</p>{summary.sourceDocuments.supplierInvoices.length === 0 ? <p className="text-sm text-muted-foreground">No hay facturas recibidas en el periodo.</p> : summary.sourceDocuments.supplierInvoices.map((document) => <Link className="flex items-center justify-between rounded-[2px] border p-3 text-sm hover:bg-accent" href={`/expenses/${document.id}`} key={document.id}><span><span className="font-medium">{document.number}</span><span className="block text-xs text-muted-foreground">{formatDate(document.issueDate)}</span></span><span className="font-mono font-semibold">{formatMoney(document.totalAmount, ctx.company.baseCurrencyCode)}</span></Link>)}</div>
          </div>
        </PageSection>
      ) : null}
    </PageShell>
  );
}
