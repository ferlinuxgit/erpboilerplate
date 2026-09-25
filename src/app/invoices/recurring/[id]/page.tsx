import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RecurringInvoiceForm } from "@/components/recurring/recurring-invoice-form";
import { RecurringRunHistory } from "@/components/recurring/recurring-run-history";
import { RecurringStatusActions } from "@/components/recurring/recurring-status-actions";
import { scheduleDraftFromTemplate } from "@/components/recurring/schedule-draft";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { db } from "@/lib/db";
import { listSelectableSeries } from "@/server/documents/series";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { issueModeLabels } from "@/server/recurring/schemas";
import { describeSchedule, formatScheduleDate } from "@/server/recurring/schedule";
import { getRecurringTemplateDetail, listRecurringCustomerOptions } from "@/server/recurring/service";

export const metadata: Metadata = { title: "Factura recurrente" };

const statusLabels = { ACTIVE: "Activa", PAUSED: "En pausa", FINISHED: "Terminada" } as const;
const statusTones = { ACTIVE: "success", PAUSED: "warning", FINISHED: "neutral" } as const;

export default async function RecurringInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserSession();
  const ctx = await requireContext("invoice.read");
  const { id } = await params;
  const detail = await getRecurringTemplateDetail(ctx.company.id, id);
  if (!detail || detail.template.kind !== "SALES_INVOICE") notFound();
  const { template } = detail;
  const canEdit = can(ctx.membership.role, "invoice.create");
  const [customers, invoiceSeries] = canEdit
    ? await Promise.all([listRecurringCustomerOptions(ctx.company.id), listSelectableSeries(db, ctx.company.id, ctx.fiscalYear.id, "SALES_INVOICE")])
    : [[], []];
  const currencyCode = ctx.company.baseCurrencyCode;
  const lastPeriod = detail.runs[0]?.periodDate ?? null;
  const issueMode = template.issueMode === "ISSUE" || template.issueMode === "ISSUE_AND_EMAIL" ? template.issueMode : "DRAFT";

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Comercial" }, { label: "Facturas", href: "/invoices" }, { label: "Recurrentes", href: "/invoices/recurring" }, { label: template.name }]}
        title={template.name}
        description={`${detail.partyName} · ${describeSchedule(template)} · ${issueModeLabels[template.issueMode]}`}
        meta={<StatusBadge tone={statusTones[template.status]}>{statusLabels[template.status]}</StatusBadge>}
        actions={canEdit ? <RecurringStatusActions afterDeleteHref="/invoices/recurring" id={template.id} name={template.name} status={template.status} /> : null}
      />
      {template.lastError ? <InlineAlert title="La última generación falló" tone="danger">{template.lastError}. Se reintentará automáticamente.</InlineAlert> : null}

      <PageSection title="Resumen">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted-foreground">Importe de cada factura</dt><dd className="font-mono font-semibold">{formatMoney(detail.estimatedTotal, currencyCode)}</dd></div>
          <div><dt className="text-muted-foreground">Generadas</dt><dd className="font-semibold">{template.occurrencesGenerated}{template.maxOccurrences ? ` de ${template.maxOccurrences}` : ""}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Próximas fechas</dt>
            <dd className="font-semibold" data-testid="recurring-upcoming">
              {template.status === "PAUSED" ? "En pausa" : detail.upcoming.length > 0 ? detail.upcoming.map(formatScheduleDate).join(" · ") : "Ninguna (terminada)"}
            </dd>
          </div>
        </dl>
      </PageSection>

      <PageSection title="Facturas generadas" description="Cada fecha se genera una sola vez, aunque el proceso se ejecute varias veces.">
        <RecurringRunHistory currencyCode={currencyCode} runs={detail.runs} />
      </PageSection>

      {canEdit ? (
        <PageSection title="Editar" description="Los cambios se aplican a las próximas facturas; las ya generadas no se modifican.">
          <RecurringInvoiceForm
            customers={customers}
            invoiceSeries={invoiceSeries}
            generated={{ lastPeriod, count: template.occurrencesGenerated }}
            initial={{
              name: template.name,
              customerId: template.customerId ?? "",
              lines: template.lines.map((line) => ({ ...line, discountPct: line.discountPct ?? 0 })),
              notes: template.notes ?? "",
              issueMode,
              schedule: scheduleDraftFromTemplate(template),
              sourceInvoiceId: template.sourceInvoiceId,
              seriesId: template.seriesId,
              vatTreatment: template.vatTreatment,
            }}
            templateId={template.id}
            wasAutomatic={issueMode !== "DRAFT"}
          />
        </PageSection>
      ) : null}
    </PageShell>
  );
}
