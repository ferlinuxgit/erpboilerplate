import { CreateBankAccountForm } from "@/components/treasury/create-bank-account-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listTreasuryLedgerAccounts } from "@/server/treasury/service";

export default async function NewBankAccountPage() {
  const ctx = await requireContext("treasury.write");
  const canWriteTreasury = can(ctx.membership.role, "treasury.write");
  const ledgerAccounts = await listTreasuryLedgerAccounts(ctx.company.id);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Nueva cuenta bancaria"
        description={`Añade una cuenta operativa para ${ctx.company.name}.`}
        backHref="/treasury"
        backLabel="Volver a tesorería"
      />

      <PageSection title="Datos bancarios" description="Banco, IBAN y cuenta contable donde se registrarán sus cobros, pagos y movimientos.">
        {canWriteTreasury ? (
          <CreateBankAccountForm ledgerAccounts={ledgerAccounts} redirectHref="/treasury/bank-accounts" />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear cuentas bancarias." />
        )}
      </PageSection>
    </PageShell>
  );
}
