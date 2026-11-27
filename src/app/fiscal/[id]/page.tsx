import Link from "next/link";
import { notFound } from "next/navigation";

import { FiscalBoxesTable } from "@/components/fiscal/fiscal-boxes-table";
import { FiscalReportRowActions } from "@/components/fiscal/fiscal-report-row-actions";
import { MarkFiscalReportFiledButton } from "@/components/fiscal/mark-fiscal-report-filed-button";
import { HelpTerm } from "@/components/help/help-term";
import { buttonVariants } from "@/components/ui/button";
import { InlineAlert, MetricCard, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { MobileRecord, MobileRecordField, MobileRecordFields, MobileRecordList, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/current-context";
import { requireCountryFeaturePage } from "@/server/fiscal/country-guard";
import { fiscalStatusLabels, getSpanishFiscalModel } from "@/lib/fiscal-spain";
import { modelo349KeyLabels } from "@/server/fiscal/spain-calc";
import { formatDate, formatMoney } from "@/lib/format";
import { describeDaysUntil } from "@/lib/pluralize";
import { can } from "@/lib/rbac";
import { getFiscalReportView } from "@/server/fiscal/service";

const statusTone = { DRAFT: "neutral", READY: "warning", FILED: "success" } as const;

export default async function FiscalReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("fiscal.read");
  requireCountryFeaturePage(ctx.company.countryCode, "taxReports");
  const { id } = await params;
  const report = await getFiscalReportView(ctx.company.id, id);
  if (!report) notFound();

  const summary = report.summary;
  const canWrite = can(ctx.membership.role, "fiscal.write");
  const currency = ctx.company.baseCurrencyCode;
  const model = getSpanishFiscalModel(report.code);
  const box130 = (code: string) => summary?.modelo130?.boxes.find((box) => box.box === code)?.amount ?? 0;
  const dueHelper = report.status === "FILED" ? "Presentado" : summary?.daysUntilDue === null || summary?.daysUntilDue === undefined ? "No aplicable" : describeDaysUntil(summary.daysUntilDue);
  const glossaryTerm = (["303", "390", "347", "349", "111", "115", "130"] as const).find((term) => term === report.code);
  // Operadores del 349: los del periodo y después las rectificaciones de periodos anteriores.
  const operators349 = summary?.modelo349
    ? [
        ...summary.modelo349.operators.map((operator) => ({ ...operator, originalPeriod: null as string | null, rowKey: `${operator.key}-${operator.taxId}` })),
        ...summary.modelo349.rectifications.map((operator) => ({ ...operator, rowKey: `r-${operator.key}-${operator.taxId}-${operator.originalPeriod}` })),
      ]
    : [];
  // Un modelo presentado ya no tiene plazo pendiente (la foto guarda el estado del día de la presentación).
  const dueTone = report.status === "FILED" ? "neutral" as const : summary?.dueStatus === "overdue" ? "danger" as const : summary?.dueStatus === "due-soon" ? "warning" as const : "neutral" as const;
  const dueHelperWithDebit = report.status !== "FILED" && summary?.directDebitDate ? `${dueHelper} · domiciliación hasta el ${formatDate(summary.directDebitDate)}` : dueHelper;
  const settlement = summary?.vatSettlement;
  const thirdParties = summary?.thirdPartyOperations;
  const isWithholdingModel = summary?.code === "111" || summary?.code === "115";
  const differences = report.snapshotDifferences ?? [];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Fiscalidad · Modelo"
        title={summary?.modelName ?? `Modelo ${report.code}`}
        description={`${summary?.periodLabel ?? report.period} · actualizado ${formatDate(report.updatedAt)}`}
        backHref="/fiscal"
        backLabel="Volver a fiscalidad"
        meta={<StatusBadge tone={statusTone[report.status]}>{fiscalStatusLabels[report.status]}</StatusBadge>}
        actions={
          <>
            {canWrite && report.status !== "FILED" ? (
              <MarkFiscalReportFiledButton
                hasPayment={(summary?.amountDue ?? 0) > 0}
                modelName={model?.name ?? `Modelo ${report.code}`}
                periodLabel={summary?.periodLabel ?? report.period}
                reportId={report.id}
              />
            ) : null}
            {model ? (
              <a className={buttonVariants({ variant: "outline" })} href={model.aeatUrl} rel="noopener noreferrer" target="_blank">
                {model.authority === "ATC" ? "Presentar en la Agencia Tributaria Canaria" : "Presentar en la sede de la AEAT"}<span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            ) : null}
            <FiscalReportRowActions canWrite={canWrite} hideView report={report} />
          </>
        }
      />

      {model ? (
        <p className="text-sm text-muted-foreground">
          {model.plainHelp}{" "}
          {glossaryTerm ? <HelpTerm term={glossaryTerm}>Más información</HelpTerm> : null}
        </p>
      ) : null}

      {report.status === "FILED" ? (
        <InlineAlert title="Presentado" tone="success">
          {report.filedAt ? `Presentado el ${formatDate(report.filedAt)}` : "Marcado como presentado"}
          {report.filingReceiptNumber ? ` · Justificante ${report.filingReceiptNumber}` : ""}
          {report.paymentNrc ? ` · NRC ${report.paymentNrc}` : ""}. El periodo está bloqueado: para cambiar algo, edita el modelo y reábrelo indicando el motivo.
          {report.summarySource === "snapshot" ? " Los importes de esta página son los que se presentaron: se guardaron ese día y no se recalculan." : ""}
        </InlineAlert>
      ) : null}

      {report.summarySource === "live-unsnapshotted" ? (
        <InlineAlert title="Importes recalculados, no los presentados" tone="warning">
          Este modelo se marcó como presentado antes de que el programa guardase una copia de lo presentado, así que los importes se calculan con los datos de hoy y pueden no coincidir con lo que enviaste. Compáralos con tu justificante de la AEAT.
        </InlineAlert>
      ) : null}

      {report.summarySource === "snapshot" && differences.length > 0 ? (
        <InlineAlert title="Los datos han cambiado desde la presentación" tone="danger">
          <p>Con los datos de hoy el cálculo ya no coincide con lo presentado: puede proceder una autoliquidación complementaria o rectificativa. Revisa qué facturas se han añadido, anulado o cambiado de fecha en este periodo.</p>
          <ul className="mt-2 space-y-1">
            {differences.slice(0, 12).map((difference) => (
              <li key={difference.label}>
                <span className="font-medium">{difference.label}:</span>{" "}
                presentado {difference.filed === null ? "—" : formatMoney(difference.filed, currency)} · ahora {difference.current === null ? "—" : formatMoney(difference.current, currency)}
              </li>
            ))}
          </ul>
          {differences.length > 12 ? <p className="mt-1">Y {differences.length - 12} diferencia(s) más.</p> : null}
        </InlineAlert>
      ) : null}

      {summary?.modelo130 ? (
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Ingresos del año (01)" value={formatMoney(box130("01"), currency)} helper="Bases de tus facturas emitidas desde el 1 de enero" />
          <MetricCard label="Gastos del año (02)" value={formatMoney(box130("02"), currency)} helper="Facturas recibidas deducibles" />
          <MetricCard label="Resultado (19)" value={formatMoney(summary.modelo130.resultCents / 100, currency)} helper={summary.modelo130.resultCents > 0 ? "A ingresar" : summary.modelo130.resultCents < 0 ? "Negativo: se descuenta el próximo trimestre" : "Sin pago"} tone={summary.modelo130.resultCents > 0 ? "warning" : "success"} />
          <MetricCard label="Vencimiento" value={summary.dueDate ? formatDate(summary.dueDate) : "Sin fecha"} helper={dueHelperWithDebit} tone={dueTone} />
        </section>
      ) : summary?.modelo349 ? (
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Operadores" value={summary.modelo349.operatorCount} helper="Clientes y proveedores de la UE a declarar" />
          <MetricCard label="Importe total" value={formatMoney(summary.modelo349.totalAmount, currency)} helper="Suma de bases (no se paga nada)" />
          <MetricCard label="Rectificaciones" value={formatMoney(summary.modelo349.rectificationAmount, currency)} helper="De periodos anteriores" />
          <MetricCard label="Vencimiento" value={summary.dueDate ? formatDate(summary.dueDate) : "Sin fecha"} helper={dueHelperWithDebit} tone={dueTone} />
        </section>
      ) : thirdParties ? (
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Terceros a declarar" value={thirdParties.length} helper="Con más de 3.005,06 € en el año" />
          <MetricCard label="Ventas declaradas" value={formatMoney(thirdParties.filter((operation) => operation.type === "customer").reduce((total, operation) => total + operation.amount, 0), currency)} helper={`${thirdParties.filter((operation) => operation.type === "customer").length} cliente(s) · IVA incluido`} />
          <MetricCard label="Compras declaradas" value={formatMoney(thirdParties.filter((operation) => operation.type === "supplier").reduce((total, operation) => total + operation.amount, 0), currency)} helper={`${thirdParties.filter((operation) => operation.type === "supplier").length} proveedor(es) · IVA incluido`} />
          <MetricCard label="Vencimiento" value={summary?.dueDate ? formatDate(summary.dueDate) : "Sin fecha"} helper={dueHelperWithDebit} tone={dueTone} />
        </section>
      ) : isWithholdingModel ? (
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Base de las retenciones" value={formatMoney(summary?.withholdingBase ?? 0, currency)} helper={`${summary?.supplierInvoiceCount ?? 0} facturas recibidas en el periodo`} />
          <MetricCard label="Retenciones practicadas" value={formatMoney(summary?.withholdingAmount ?? 0, currency)} helper="Lo que retuviste al pagar" />
          <MetricCard label="A ingresar" value={formatMoney(summary?.amountDue ?? 0, currency)} helper={(summary?.amountDue ?? 0) > 0 ? "Se ingresa en Hacienda" : "Sin retenciones en el periodo"} tone={(summary?.amountDue ?? 0) > 0 ? "warning" : "success"} />
          <MetricCard label="Vencimiento" value={summary?.dueDate ? formatDate(summary.dueDate) : "Sin fecha"} helper={dueHelperWithDebit} tone={dueTone} />
        </section>
      ) : (
      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label={summary?.code === "303" ? "IVA devengado (27)" : "Impuesto devengado"} value={formatMoney(summary?.outputTaxAmount ?? 0, ctx.company.baseCurrencyCode)} helper={`${summary?.salesInvoiceCount ?? 0} facturas emitidas · incluye recargo y autorepercusiones`} />
        <MetricCard label={summary?.code === "303" ? "IVA deducible (45)" : "Impuesto deducible"} value={formatMoney(summary?.deductibleInputTaxAmount ?? 0, ctx.company.baseCurrencyCode)} helper={`${summary?.supplierInvoiceCount ?? 0} facturas recibidas`} />
        {settlement ? (
          <MetricCard
            label="Resultado (71)"
            value={formatMoney(settlement.result, currency)}
            helper={settlement.applied > 0
              ? `Tras compensar ${formatMoney(settlement.applied, currency)} de periodos anteriores`
              : settlement.result > 0 ? "A ingresar" : settlement.result < 0 ? (settlement.lastPeriod ? "A compensar o devolver" : "A compensar en los siguientes periodos") : "Sin ingreso"}
            tone={settlement.result > 0 ? "warning" : "success"}
          />
        ) : (
          <MetricCard label={summary?.code === "390" ? "Resultado del año" : "Resultado"} value={formatMoney(summary?.settlementAmount ?? 0, ctx.company.baseCurrencyCode)} helper={summary?.code === "390" ? "Informativo: se paga con cada 303" : (summary?.settlementAmount ?? 0) >= 0 ? "A ingresar" : "A compensar"} tone={summary?.code !== "390" && (summary?.settlementAmount ?? 0) > 0 ? "warning" : "success"} />
        )}
        <MetricCard label="Vencimiento" value={summary?.dueDate ? formatDate(summary.dueDate) : "Sin fecha"} helper={dueHelperWithDebit} tone={dueTone} />
      </section>
      )}

      {settlement && (settlement.pendingBefore > 0 || settlement.carryForward > 0) ? (
        <InlineAlert title="Cuotas a compensar" tone="info">
          Resultado del periodo (casilla 46): {formatMoney(summary?.settlementAmount ?? 0, currency)}. Pendiente de periodos anteriores (110): {formatMoney(settlement.pendingBefore, currency)}
          {settlement.openingAmount > 0 ? `, de los que ${formatMoney(settlement.openingAmount, currency)} son el saldo de ejercicios anteriores indicado en Configuración › Fiscalidad` : ""}.
          {" "}Aplicado ahora (78): {formatMoney(settlement.applied, currency)}. Queda a tu favor para los siguientes periodos: {formatMoney(settlement.carryForward, currency)}.
        </InlineAlert>
      ) : null}

      {summary?.warnings.map((warning) => <InlineAlert key={warning} tone="warning">{warning}</InlineAlert>)}

      {summary?.modelo130 ? (
        <PageSection title="Casillas del modelo 130" description="Cálculo acumulado desde el 1 de enero. Copia estos importes en la sede electrónica de la AEAT.">
          <FiscalBoxesTable boxes={summary.modelo130.boxes} caption="Casillas del modelo 130" currencyCode={currency} />
        </PageSection>
      ) : null}

      {summary?.modelo349 ? (
        <PageSection title="Operadores intracomunitarios" description="Un registro por NIF-IVA y clave. E: ventas de bienes · S: servicios prestados · A: compras de bienes · I: servicios recibidos.">
          {summary.modelo349.operators.length === 0 && summary.modelo349.rectifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay operaciones intracomunitarias en el periodo: no tienes que presentar el 349.</p>
          ) : (
            <>
              <TableContainer className="hidden md:block">
                <Table>
                  <TableHeader><TableRow><TableHead>Clave</TableHead><TableHead>NIF-IVA</TableHead><TableHead>Nombre</TableHead><TableHead>Periodo rectificado</TableHead><TableHead className="text-right">Base</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {operators349.map((operator) => (
                      <TableRow key={operator.rowKey}>
                        <TableCell title={modelo349KeyLabels[operator.key]}>{operator.key}</TableCell>
                        <TableCell>{operator.taxId}</TableCell>
                        <TableCell>{operator.name}</TableCell>
                        <TableCell>{operator.originalPeriod ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">{formatMoney(operator.amount, currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <MobileRecordList aria-label="Operadores intracomunitarios">
                {operators349.map((operator) => (
                  <MobileRecord aside={formatMoney(operator.amount, currency)} key={operator.rowKey} title={operator.name}>
                    <MobileRecordFields>
                      <MobileRecordField label="Clave">{operator.key}{modelo349KeyLabels[operator.key] ? ` · ${modelo349KeyLabels[operator.key]}` : ""}</MobileRecordField>
                      <MobileRecordField label="NIF-IVA">{operator.taxId}</MobileRecordField>
                      {operator.originalPeriod ? <MobileRecordField label="Periodo rectificado">{operator.originalPeriod}</MobileRecordField> : null}
                    </MobileRecordFields>
                  </MobileRecord>
                ))}
              </MobileRecordList>
            </>
          )}
        </PageSection>
      ) : null}

      {thirdParties ? (
        <PageSection title="Terceros a declarar" description="Un registro por NIF: clientes y proveedores con más de 3.005,06 € en el año, IVA incluido y repartido por trimestres naturales.">
          {thirdParties.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ningún cliente ni proveedor supera 3.005,06 € en el año: no tienes que presentar el 347.</p>
          ) : (
            <>
              <TableContainer className="hidden md:block">
                <Table className="[&_td:nth-child(n+4)]:whitespace-nowrap">
                  <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>NIF</TableHead><TableHead>Nombre</TableHead><TableHead className="text-right">1T</TableHead><TableHead className="text-right">2T</TableHead><TableHead className="text-right">3T</TableHead><TableHead className="text-right">4T</TableHead><TableHead className="text-right">Total año</TableHead><TableHead className="text-right">En metálico</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {thirdParties.map((operation) => (
                      <TableRow key={`${operation.type}-${operation.taxId}-${operation.name}`}>
                        <TableCell>{operation.type === "customer" ? "Cliente" : "Proveedor"}</TableCell>
                        <TableCell>{operation.taxId}</TableCell>
                        <TableCell>{operation.name}</TableCell>
                        {(operation.quarters ?? [0, 0, 0, 0]).map((amount, index) => <TableCell className="text-right" key={index}>{formatMoney(amount, currency)}</TableCell>)}
                        <TableCell className="text-right font-semibold">{formatMoney(operation.amount, currency)}</TableCell>
                        <TableCell className="text-right">{operation.cashAmount !== undefined ? formatMoney(operation.cashAmount, currency) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <MobileRecordList aria-label="Terceros a declarar en el 347">
                {thirdParties.map((operation) => (
                  <MobileRecord aside={formatMoney(operation.amount, currency)} key={`${operation.type}-${operation.taxId}-${operation.name}`} title={operation.name}>
                    <MobileRecordFields>
                      <MobileRecordField label="Tipo">{operation.type === "customer" ? "Cliente" : "Proveedor"}</MobileRecordField>
                      <MobileRecordField label="NIF">{operation.taxId}</MobileRecordField>
                      {(operation.quarters ?? []).map((amount, index) => amount !== 0 ? <MobileRecordField key={index} label={`${index + 1}T`}>{formatMoney(amount, currency)}</MobileRecordField> : null)}
                      {operation.cashAmount !== undefined ? <MobileRecordField label="En metálico">{formatMoney(operation.cashAmount, currency)}</MobileRecordField> : null}
                    </MobileRecordFields>
                  </MobileRecord>
                ))}
              </MobileRecordList>
            </>
          )}
        </PageSection>
      ) : null}

      {summary?.annualSummaryBoxes ? (
        <PageSection title="Resumen anual del IVA" description="Importes del año para preparar el 390. Van sin número de casilla: la numeración oficial del 390 no está contrastada, así que busca en el formulario el apartado con el mismo concepto.">
          <FiscalBoxesTable boxes={summary.annualSummaryBoxes} caption="Resumen anual del IVA (modelo 390)" currencyCode={currency} />
        </PageSection>
      ) : null}

      {summary && !summary.modelo130 && !summary.modelo349 && !thirdParties ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <PageSection title="Desglose de IVA" description="Bases y cuotas por tipo. El soportado muestra la cuota íntegra, antes de prorrata.">
            <TableContainer>
              <Table className="[&_td:nth-child(n+3)]:whitespace-nowrap">
                <TableHeader><TableRow><TableHead>Origen</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Cuota</TableHead></TableRow></TableHeader>
                <TableBody>
                  {summary.buckets.map((bucket) => <TableRow key={`out-${bucket.rate}`}><TableCell>Repercutido</TableCell><TableCell>{bucket.rate}%</TableCell><TableCell className="text-right">{formatMoney(bucket.base, ctx.company.baseCurrencyCode)}</TableCell><TableCell className="text-right">{formatMoney(bucket.tax, ctx.company.baseCurrencyCode)}</TableCell></TableRow>)}
                  {summary.surchargeBuckets.map((bucket) => <TableRow key={`re-${bucket.rate}`}><TableCell>Recargo equivalencia</TableCell><TableCell>{bucket.rate}%</TableCell><TableCell className="text-right">{formatMoney(bucket.base, ctx.company.baseCurrencyCode)}</TableCell><TableCell className="text-right">{formatMoney(bucket.tax, ctx.company.baseCurrencyCode)}</TableCell></TableRow>)}
                  {summary.inputBuckets.map((bucket) => <TableRow key={`in-${bucket.rate}`}><TableCell>Soportado</TableCell><TableCell>{bucket.rate}%</TableCell><TableCell className="text-right">{formatMoney(bucket.base, ctx.company.baseCurrencyCode)}</TableCell><TableCell className="text-right">{formatMoney(bucket.tax, ctx.company.baseCurrencyCode)}</TableCell></TableRow>)}
                </TableBody>
              </Table>
            </TableContainer>
          </PageSection>

          <PageSection title="Conciliación contable" description="Si algo no cuadra, revisa asientos manuales en esas cuentas o documentos anulados en otro periodo." contentClassName="space-y-3">
            {([
              ["IVA devengado (477)", summary.accountingReconciliation.outputVat],
              ["IVA deducible (472)", summary.accountingReconciliation.inputVat],
              ["Retenciones practicadas (4751)", summary.accountingReconciliation.withholdings],
              ["Retenciones soportadas (473)", summary.accountingReconciliation.salesWithholdings],
            ] as const).map(([label, line]) => (
              <div className="grid grid-cols-[1fr_auto] gap-3 rounded-surface border p-3" key={label}>
                <div><p className="font-medium">{label}</p><p className="mt-1 text-sm text-muted-foreground">Fiscal {formatMoney(line.fiscalAmount, ctx.company.baseCurrencyCode)} · Contable {formatMoney(line.accountingAmount, ctx.company.baseCurrencyCode)}</p></div>
                <StatusBadge tone={Math.abs(line.difference) < 0.01 ? "success" : "warning"}>{Math.abs(line.difference) < 0.01 ? "Conciliado" : formatMoney(line.difference, ctx.company.baseCurrencyCode)}</StatusBadge>
              </div>
            ))}
          </PageSection>
        </section>
      ) : summary ? null : <InlineAlert tone="danger">No se ha podido calcular el resumen de este modelo.</InlineAlert>}

      {summary?.canaryBoxes ? (
        <PageSection
          title={`Casillas del ${model?.name ?? `modelo ${summary.code}`}`}
          description="Borrador por casillas según las instrucciones de la Agencia Tributaria Canaria. Revísalas antes de copiarlas en su programa de ayuda o en la sede electrónica."
        >
          <FiscalBoxesTable authority="ATC" boxes={summary.canaryBoxes} caption={`Casillas del ${model?.name ?? summary.code}`} currencyCode={currency} reviewBoxes={["REV"]} />
        </PageSection>
      ) : null}
      {summary && summary.code === "303" ? (
        <PageSection title="Casillas del modelo 303" description="Borrador por casillas según las instrucciones de la AEAT. Revísalas antes de copiarlas en la sede electrónica. Las de «volumen del año» (80 a 88) solo se rellenan en el último periodo si estás exonerado de presentar el 390.">
          <FiscalBoxesTable boxes={summary.modelo303Boxes} caption="Casillas del modelo 303" currencyCode={currency} reviewBoxes={["REV", "EXE"]} />
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
        <PageSection title="Documentos incluidos" description={report.summarySource === "snapshot" ? "Facturas que hay hoy en el periodo (la copia de lo presentado guarda los importes, no la lista de facturas)." : "Facturas que alimentan el cálculo del periodo."}>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2"><p className="text-sm font-medium">Facturas emitidas</p>{summary.sourceDocuments.salesInvoices.length === 0 ? <p className="text-sm text-muted-foreground">No hay facturas emitidas en el periodo.</p> : summary.sourceDocuments.salesInvoices.map((document) => <Link className="flex items-center justify-between rounded-surface border p-3 text-sm hover:bg-accent" href={`/invoices/${document.id}`} key={document.id}><span><span className="font-medium">{document.number}</span><span className="block text-xs text-muted-foreground">{formatDate(document.issueDate)}{document.accrualDate ? ` · operación del ${formatDate(document.accrualDate)}` : ""}</span></span><span className="font-mono font-semibold">{formatMoney(document.totalAmount, ctx.company.baseCurrencyCode)}</span></Link>)}</div>
            <div className="space-y-2"><p className="text-sm font-medium">Facturas recibidas</p>{summary.sourceDocuments.supplierInvoices.length === 0 ? <p className="text-sm text-muted-foreground">No hay facturas recibidas en el periodo.</p> : summary.sourceDocuments.supplierInvoices.map((document) => <Link className="flex items-center justify-between rounded-surface border p-3 text-sm hover:bg-accent" href={`/expenses/${document.sourceId ?? document.id}`} key={document.id}><span><span className="font-medium">{document.number}</span><span className="block text-xs text-muted-foreground">{formatDate(document.issueDate)}</span></span><span className="font-mono font-semibold">{formatMoney(document.totalAmount, ctx.company.baseCurrencyCode)}</span></Link>)}</div>
          </div>
        </PageSection>
      ) : null}
    </PageShell>
  );
}
