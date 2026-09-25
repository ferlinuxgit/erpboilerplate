import type { Metadata } from "next";
import Link from "next/link";

import { PendingExpenseRuns } from "@/components/recurring/pending-expense-runs";
import { RecurringTemplatesList } from "@/components/recurring/recurring-templates-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { listPendingExpenseRuns, listRecurringTemplates } from "@/server/recurring/service";

export const metadata: Metadata = { title: "Gastos recurrentes" };

export default async function RecurringExpensesPage() {
  await requireUserSession();
  const ctx = await requireContext("expense.read");
  const [rows, pending] = await Promise.all([listRecurringTemplates(ctx.company.id, "EXPENSE"), listPendingExpenseRuns(ctx.company.id)]);
  const canEdit = can(ctx.membership.role, "expense.write");

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Compras y gastos" }, { label: "Gastos", href: "/expenses" }, { label: "Recurrentes" }]}
        title="Gastos recurrentes"
        description="Alquiler, cuotas, suscripciones o la cuota de autónomos: se preparan solos cada periodo para que solo tengas que confirmarlos."
        actions={canEdit ? <Link className={buttonVariants()} href="/expenses/recurring/new">Nuevo gasto recurrente</Link> : null}
      />
      <PageSection
        title={`Pendientes de revisar${pending.length > 0 ? ` (${pending.length})` : ""}`}
        description="Confirma el importe (si ha cambiado) para registrarlos, o descártalos si ese periodo no hubo cargo."
      >
        <PendingExpenseRuns
          canEdit={canEdit}
          runs={pending.map((run) => ({
            id: run.id,
            templateName: run.templateName,
            supplierName: run.supplierName,
            periodDate: run.periodDate,
            message: run.message,
            lines: run.lines.map((line) => ({ description: line.description, unitPrice: line.unitPrice })),
            estimatedTotal: run.estimatedTotal,
          }))}
        />
      </PageSection>
      <PageSection title="Recurrencias">
        <RecurringTemplatesList basePath="/expenses/recurring" canEdit={canEdit} currencyCode={ctx.company.baseCurrencyCode} kind="EXPENSE" rows={rows} />
      </PageSection>
    </PageShell>
  );
}
