import type { Metadata } from "next";

import { ChartOfAccountsView } from "@/components/accounting/chart/chart-of-accounts-view";
import { LoadChartTemplateButton } from "@/components/accounting/chart/load-chart-template-button";
import { HelpTerm } from "@/components/help/help-term";
import { EmptyState, PageHeader, PageShell } from "@/components/ui/page";
import { chartLevelDepth, parseChartUrlState } from "@/lib/chart-of-accounts/query";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { countAccounts, getChartTree, resolveChartPeriod } from "@/server/accounting/chart-tree";

export const metadata: Metadata = { title: "Plan contable" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext("accounting.read");
  const state = parseChartUrlState(await searchParams);
  const canManage = can(ctx.membership.role, "accounting.write");
  const total = await countAccounts(ctx.company.id);

  const header = (
    <PageHeader
      eyebrow="Contabilidad"
      title="Plan contable"
      description={total > 0 ? `${total} cuentas por grupos del PGC, con sumas y saldos del periodo.` : "Cuentas, grupos y subcuentas de la empresa."}
      backHref="/accounting"
      backLabel="Volver al resumen"
      actions={<HelpTerm term="deudor-acreedor">¿Saldo deudor o acreedor?</HelpTerm>}
    />
  );

  if (total === 0) {
    const canLoadTemplate = can(ctx.membership.role, "settings.manage");
    return (
      <PageShell>
        {header}
        <EmptyState
          action={canLoadTemplate ? <LoadChartTemplateButton /> : null}
          description={canLoadTemplate ? "Carga el Plan General Contable con sus grupos, subgrupos y cuentas para empezar a contabilizar." : "Pide a un administrador que cargue la plantilla contable de la empresa."}
          title="Plan contable vacío"
        />
      </PageShell>
    );
  }

  const period = await resolveChartPeriod(ctx.company.id, { fy: state.fy, from: state.from, to: state.to, activeFiscalYearId: ctx.fiscalYear.id });
  const selection = state.sel && /^\d{1,20}$/.test(state.sel) ? state.sel : null;
  const initialTree = await getChartTree(ctx.company.id, {
    ...period.range,
    depth: chartLevelDepth(state.level),
    q: state.q || null,
    reveal: state.q ? null : selection,
    filters: state.filters,
  });

  return (
    <PageShell>
      {header}
      <ChartOfAccountsView
        activeYearId={period.year?.id ?? null}
        canManage={canManage}
        currency={ctx.company.baseCurrencyCode}
        initialState={{ ...state, sel: selection }}
        initialTree={initialTree}
        years={period.years}
      />
    </PageShell>
  );
}
