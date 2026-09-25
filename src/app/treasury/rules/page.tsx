import { ReconciliationRulesManager } from "@/components/treasury/reconciliation-rules-manager";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listReconciliationRules, listRulePartners } from "@/server/treasury/rules";
import { listAssignableAccounts } from "@/server/treasury/workbench";

export default async function ReconciliationRulesPage() {
  const ctx = await requireContext("treasury.read");
  const [rules, accounts, partners] = await Promise.all([
    listReconciliationRules(ctx.company.id),
    listAssignableAccounts(ctx.company.id),
    listRulePartners(ctx.company.id),
  ]);
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Reglas de conciliación"
        description="Enseña a la aplicación a reconocer tus movimientos habituales: «si el concepto contiene COMISION, es la cuenta 626»."
        backHref="/treasury/reconciliation"
        backLabel="Volver a la conciliación"
      />
      <PageSection title="Reglas" description="Se usan como propuestas en la conciliación; las marcadas se aplican solas al importar.">
        <ReconciliationRulesManager
          accounts={accounts}
          canWrite={can(ctx.membership.role, "treasury.write")}
          currencyCode={ctx.company.baseCurrencyCode}
          partners={partners}
          rules={rules}
        />
      </PageSection>
    </PageShell>
  );
}
