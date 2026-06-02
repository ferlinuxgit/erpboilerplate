import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import { spanishFiscalModels } from "@/lib/fiscal-spain";
import { formatDate, formatMoney } from "@/lib/format";
import type { FiscalSourceDocument } from "@/server/fiscal/spain";
import type { FiscalReportWithSummary } from "@/server/fiscal/service";

type SpanishTaxSummaryProps = {
  reports: FiscalReportWithSummary[];
};

function latestReport(reports: FiscalReportWithSummary[]) {
  return reports.find((report) => report.code === "303") ?? reports[0] ?? null;
}

const dueTone = {
  upcoming: "info",
  "due-soon": "warning",
  overdue: "danger",
} as const;

const checkTone = {
  ok: "success",
  warning: "warning",
  blocking: "danger",
} as const;

function SourceDocuments({
  documents,
  emptyText,
  hrefFor,
  title,
}: {
  documents: FiscalSourceDocument[];
  emptyText: string;
  hrefFor?: (document: FiscalSourceDocument) => string;
  title: string;
}) {
  const visibleDocuments = documents.slice(0, 8);

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <StatusBadge tone="neutral">{documents.length}</StatusBadge>
      </div>
      <div className="mt-4 grid gap-2">
        {visibleDocuments.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{emptyText}</div>
        ) : (
          visibleDocuments.map((document) => {
            const content = (
              <>
                <span className="font-medium">{document.number}</span>
                <span className="text-muted-foreground">{formatDate(document.issueDate)}</span>
                <span className="text-right font-medium">{formatMoney(document.taxAmount)}</span>
              </>
            );

            return hrefFor ? (
              <Link className="grid gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50 md:grid-cols-[minmax(0,1fr)_110px_120px]" href={hrefFor(document)} key={document.id}>
                {content}
              </Link>
            ) : (
              <div className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[minmax(0,1fr)_110px_120px]" key={document.id}>
                {content}
              </div>
            );
          })
        )}
        {documents.length > visibleDocuments.length ? (
          <p className="text-xs text-muted-foreground">Hay {documents.length - visibleDocuments.length} documentos más en el export JSON.</p>
        ) : null}
      </div>
    </div>
  );
}

export function SpanishTaxSummary({ reports }: SpanishTaxSummaryProps) {
  const activeReport = latestReport(reports);
  const activeSummary = activeReport?.summary ?? null;
  const warnings = [...new Set(reports.flatMap((report) => report.summary?.warnings ?? []))];

  return (
    <section className="space-y-4" aria-label="Resumen fiscal España">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Periodo activo</p>
          <p className="mt-1 text-2xl font-semibold">{activeSummary?.periodLabel ?? "Sin borrador"}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">IVA repercutido</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(activeSummary?.outputTaxAmount ?? 0)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">IVA soportado</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(activeSummary?.inputTaxAmount ?? 0)}</p>
          {activeSummary && activeSummary.nonDeductibleInputTaxAmount > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">{formatMoney(activeSummary.deductibleInputTaxAmount)} deducible</p>
          ) : null}
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Resultado estimado</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(activeSummary?.settlementAmount ?? 0)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Retenciones</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(activeSummary?.withholdingAmount ?? 0)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Vencimiento</p>
          <p className="mt-1 text-lg font-semibold">{activeSummary?.dueDate ? formatDate(activeSummary.dueDate) : "Sin fecha"}</p>
          {activeSummary?.dueStatus ? (
            <StatusBadge className="mt-2" tone={dueTone[activeSummary.dueStatus]}>
              {activeSummary.daysUntilDue !== null && activeSummary.daysUntilDue < 0
                ? `${Math.abs(activeSummary.daysUntilDue)} días vencido`
                : `${activeSummary.daysUntilDue} días`}
            </StatusBadge>
          ) : null}
        </div>
      </div>

      {activeSummary ? (
        <>
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium">Desglose IVA repercutido</h2>
                <p className="text-sm text-muted-foreground">{activeSummary.salesInvoiceCount} facturas emitidas incluidas</p>
              </div>
              <StatusBadge tone="info">{activeSummary.modelName}</StatusBadge>
            </div>
            <dl className="mt-4 grid gap-2">
              {activeSummary.buckets.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No hay líneas facturadas en el periodo.</div>
              ) : (
                activeSummary.buckets.map((bucket) => (
                  <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-sm" key={bucket.rate}>
                    <dt className="font-medium">{bucket.rate}%</dt>
                    <dd className="text-muted-foreground">{formatMoney(bucket.base)} base</dd>
                    <dd className="text-right font-medium">{formatMoney(bucket.tax)}</dd>
                  </div>
                ))
              )}
            </dl>
          </div>

          <div className="rounded-lg border p-4">
            <div>
              <h2 className="text-sm font-medium">Retenciones detectadas</h2>
              <p className="text-sm text-muted-foreground">{formatMoney(activeSummary.withholdingBase)} base sujeta</p>
            </div>
            <dl className="mt-4 grid gap-2">
              {activeSummary.withholdingBuckets.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No hay líneas con retención en el periodo.</div>
              ) : (
                activeSummary.withholdingBuckets.map((bucket) => (
                  <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-sm" key={bucket.rate}>
                    <dt className="font-medium">{bucket.rate}%</dt>
                    <dd className="text-muted-foreground">{formatMoney(bucket.base)} base</dd>
                    <dd className="text-right font-medium">{formatMoney(bucket.tax)}</dd>
                  </div>
                ))
              )}
            </dl>
          </div>

          <div className="rounded-lg border p-4">
            <div>
              <h2 className="text-sm font-medium">Desglose IVA soportado</h2>
              <p className="text-sm text-muted-foreground">{activeSummary.supplierInvoiceCount} facturas proveedor incluidas</p>
            </div>
            <dl className="mt-4 grid gap-2">
              {activeSummary.inputBuckets.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No hay líneas de proveedor con IVA en el periodo.</div>
              ) : (
                activeSummary.inputBuckets.map((bucket) => (
                  <div className="grid grid-cols-3 gap-3 rounded-lg border p-3 text-sm" key={bucket.rate}>
                    <dt className="font-medium">{bucket.rate}%</dt>
                    <dd className="text-muted-foreground">{formatMoney(bucket.base)} base</dd>
                    <dd className="text-right font-medium">{formatMoney(bucket.tax)}</dd>
                  </div>
                ))
              )}
            </dl>
          </div>

          <div className="rounded-lg border p-4">
            <h2 className="text-sm font-medium">Cobertura MVP fiscal</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {spanishFiscalModels.map((model) => (
                <StatusBadge key={model.code} tone={reports.some((report) => report.code === model.code) ? "success" : "neutral"}>
                  {model.name}
                </StatusBadge>
              ))}
            </div>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="rounded-lg border p-4">
            <h2 className="text-sm font-medium">Perfil fiscal automatizado</h2>
            <dl className="mt-4 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <dt className="text-muted-foreground">Régimen</dt>
                <dd className="font-medium">{activeSummary.fiscalProfile.fiscalRegime}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <dt className="text-muted-foreground">Periodicidad</dt>
                <dd className="font-medium">{activeSummary.fiscalProfile.taxPeriodicity === "monthly" ? "Mensual" : "Trimestral"}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <dt className="text-muted-foreground">Prorrata</dt>
                <dd className="font-medium">{activeSummary.fiscalProfile.prorrataPct}%</dd>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <dt className="text-muted-foreground">SII</dt>
                <StatusBadge tone={activeSummary.fiscalProfile.siiEnabled ? "warning" : "neutral"}>
                  {activeSummary.fiscalProfile.siiEnabled ? "Activado" : "No marcado"}
                </StatusBadge>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <dt className="text-muted-foreground">VERI*FACTU</dt>
                <StatusBadge tone={activeSummary.fiscalProfile.verifactuMode === "pending" ? "warning" : "success"}>
                  {activeSummary.fiscalProfile.verifactuMode}
                </StatusBadge>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">Asistente de cierre fiscal</h2>
              <StatusBadge tone={activeSummary.automationChecks.some((check) => check.status === "blocking") ? "danger" : activeSummary.automationChecks.some((check) => check.status === "warning") ? "warning" : "success"}>
                {activeSummary.automationChecks.filter((check) => check.status !== "ok").length} incidencias
              </StatusBadge>
            </div>
            <div className="mt-4 grid gap-2">
              {activeSummary.automationChecks.map((check) => (
                <div className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[120px_minmax(0,1fr)]" key={check.code}>
                  <StatusBadge tone={checkTone[check.status]}>{check.status === "blocking" ? "Bloqueante" : check.status === "warning" ? "Aviso" : "OK"}</StatusBadge>
                  <div>
                    <p className="font-medium">{check.title}</p>
                    <p className="text-muted-foreground">{check.detail}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{check.action}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {activeReport?.code === "303" ? (
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium">Pre303 por casillas</h2>
                <p className="text-sm text-muted-foreground">Borrador interno para revisión previa a AEAT; no genera fichero oficial.</p>
              </div>
              <StatusBadge tone="info">Modelo 303</StatusBadge>
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {activeSummary.modelo303Boxes.map((box) => (
                <div className="rounded-lg border p-3 text-sm" key={`${box.box}-${box.label}`}>
                  <p className="text-xs text-muted-foreground">Casilla {box.box}</p>
                  <p className="mt-1 min-h-10 font-medium">{box.label}</p>
                  <p className="mt-2 text-lg font-semibold">{formatMoney(box.amount)}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeSummary.thirdPartyOperations ? (
          <div className="rounded-lg border p-4">
            <h2 className="text-sm font-medium">Operaciones Modelo 347</h2>
            <div className="mt-4 grid gap-2">
              {activeSummary.thirdPartyOperations.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No hay clientes o proveedores por encima de 3.005,06 EUR.</div>
              ) : (
                activeSummary.thirdPartyOperations.map((operation) => (
                  <div className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[110px_minmax(0,1fr)_160px_140px]" key={`${operation.type}-${operation.taxId}-${operation.name}`}>
                    <span className="font-medium">{operation.type === "customer" ? "Cliente" : "Proveedor"}</span>
                    <span className="truncate">{operation.name}</span>
                    <span className="text-muted-foreground">{operation.taxId}</span>
                    <span className="text-right font-medium">{formatMoney(operation.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <SourceDocuments
            documents={activeSummary.sourceDocuments.salesInvoices}
            emptyText="No hay facturas emitidas en el periodo."
            hrefFor={(document) => `/invoices/${document.id}/edit`}
            title="Origen IVA repercutido"
          />
          <SourceDocuments
            documents={activeSummary.sourceDocuments.supplierInvoices}
            emptyText="No hay facturas proveedor en el periodo."
            title="Origen IVA soportado"
          />
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Conciliación fiscal-contable</h2>
              <p className="text-sm text-muted-foreground">Compara el cálculo fiscal con las cuentas 477000, 472000 y 475100.</p>
            </div>
            <StatusBadge tone={activeSummary.accountingReconciliation.balanced ? "success" : "warning"}>
              {activeSummary.accountingReconciliation.balanced ? "Cuadrado" : "Revisar"}
            </StatusBadge>
          </div>
          <div className="mt-4 grid gap-2">
            {[
              ["IVA repercutido", activeSummary.accountingReconciliation.outputVat],
              ["IVA soportado", activeSummary.accountingReconciliation.inputVat],
              ["Retenciones", activeSummary.accountingReconciliation.withholdings],
            ].map(([label, line]) => (
              <div className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[minmax(0,1fr)_140px_140px_140px]" key={label as string}>
                <span className="font-medium">{label as string}</span>
                <span className="text-muted-foreground">Fiscal {formatMoney((line as typeof activeSummary.accountingReconciliation.outputVat).fiscalAmount)}</span>
                <span className="text-muted-foreground">Contable {formatMoney((line as typeof activeSummary.accountingReconciliation.outputVat).accountingAmount)}</span>
                <span className="text-right font-medium">Dif. {formatMoney((line as typeof activeSummary.accountingReconciliation.outputVat).difference)}</span>
              </div>
            ))}
          </div>
        </div>
        </>
      ) : null}
    </section>
  );
}
