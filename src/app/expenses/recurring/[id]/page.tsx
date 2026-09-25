import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RecurringExpenseForm } from "@/components/recurring/recurring-expense-form";
import { RecurringRunHistory } from "@/components/recurring/recurring-run-history";
import { RecurringStatusActions } from "@/components/recurring/recurring-status-actions";
import { scheduleDraftFromTemplate } from "@/components/recurring/schedule-draft";
import { InlineAlert, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { formatMoney } from "@/lib/format";
import { can } from "@/lib/rbac";
import { listPostingAccounts } from "@/server/accounting/service";
import { expenseIssueModeLabels } from "@/server/recurring/schemas";
import { describeSchedule, formatScheduleDate } from "@/server/recurring/schedule";
import { getRecurringTemplateDetail } from "@/server/recurring/service";
import { listSupplierPartners } from "@/server/supplier-invoices/service";

export const metadata: Metadata = { title: "Gasto recurrente" };

const statusLabels = { ACTIVE: "Activo", PAUSED: "En pausa", FINISHED: "Terminado" } as const;
const statusTones = { ACTIVE: "success", PAUSED: "warning", FINISHED: "neutral" } as const;

export default async function RecurringExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUserSession();
  const ctx = await requireContext("expense.read");
  const { id } = await params;
  const detail = await getRecurringTemplateDetail(ctx.company.id, id);
  if (!detail || detail.template.kind !== "EXPENSE") notFound();
  const { template } = detail;
  const canEdit = can(ctx.membership.role, "expense.write");
  const [accounts, suppliers] = canEdit ? await Promise.all([listPostingAccounts(ctx.company.id), listSupplierPartners(ctx.company.id)]) : [[], []];
  const currencyCode = ctx.company.baseCurrencyCode;
  const line = template.lines[0];
  const issueMode = template.issueMode === "POST" ? "POST" : "DRAFT";

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Compras y gastos" }, { label: "Gastos", href: "/expenses" }, { label: "Recurrentes", href: "/expenses/recurring" }, { label: template.name }]}
        title={template.name}
        description={`${detail.partyName} · ${describeSchedule(template)} · ${expenseIssueModeLabels[issueMode]}`}
        meta={<StatusBadge tone={statusTones[template.status]}>{statusLabels[template.status]}</StatusBadge>}
        actions={canEdit ? <RecurringStatusActions afterDeleteHref="/expenses/recurring" id={template.id} name={template.name} status={template.status} /> : null}
      />
      {template.lastError ? <InlineAlert title="La última generación falló" tone="danger">{template.lastError}. Se reintentará automáticamente.</InlineAlert> : null}

      <PageSection title="Resumen">
        <dl className="grid gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted-foreground">Total de cada recibo</dt><dd className="font-mono font-semibold">{formatMoney(detail.estimatedTotal, currencyCode)}</dd></div>
          <div><dt className="text-muted-foreground">Generados</dt><dd className="font-semibold">{template.occurrencesGenerated}{template.maxOccurrences ? ` de ${template.maxOccurrences}` : ""}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Próximas fechas</dt>
            <dd className="font-semibold" data-testid="recurring-upcoming">
              {template.status === "PAUSED" ? "En pausa" : detail.upcoming.length > 0 ? detail.upcoming.map(formatScheduleDate).join(" · ") : "Ninguna (terminado)"}
            </dd>
          </div>
        </dl>
      </PageSection>

      <PageSection title="Historial" description="Los pendientes de revisar se confirman desde «Gastos recurrentes».">
        <RecurringRunHistory currencyCode={currencyCode} runs={detail.runs} />
      </PageSection>

      {canEdit && line ? (
        <PageSection title="Editar" description="Los cambios se aplican a los próximos periodos.">
          <RecurringExpenseForm
            accounts={accounts.filter((account) => account.type === "EXPENSE" || account.code.startsWith("6")).map((account) => ({ id: account.id, code: account.code, name: account.name }))}
            generated={{ lastPeriod: detail.runs[0]?.periodDate ?? null, count: template.occurrencesGenerated }}
            initial={{
              name: template.name,
              supplierPartnerId: template.supplierPartnerId ?? "",
              expenseAccountId: line.expenseAccountId ?? "",
              description: line.description,
              amount: line.unitPrice * line.quantity,
              taxRate: line.taxRate,
              retentionRate: line.retentionRate,
              taxDeductiblePct: line.taxDeductiblePct ?? 100,
              issueMode,
              schedule: scheduleDraftFromTemplate(template),
            }}
            suppliers={suppliers.map((supplier) => ({
              id: supplier.id,
              number: supplier.number,
              name: supplier.name,
              taxId: supplier.taxId,
              defaults: {
                defaultExpenseAccountId: supplier.defaults.defaultExpenseAccountId,
                defaultRetentionRate: supplier.defaults.defaultRetentionRate,
                defaultTaxDeductiblePct: supplier.defaults.defaultTaxDeductiblePct,
              },
            }))}
            templateId={template.id}
            wasAutomatic={issueMode === "POST"}
          />
        </PageSection>
      ) : null}
    </PageShell>
  );
}
