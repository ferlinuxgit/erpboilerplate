import { CreateBankAccountForm } from "@/components/treasury/create-bank-account-form";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listTreasuryLedgerAccounts, listUnlinkedPaymentMethods } from "@/server/treasury/service";

export default async function NewBankAccountPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await requireContext("treasury.write");
  const canWriteTreasury = can(ctx.membership.role, "treasury.write");
  const [ledgerAccounts, unlinkedPaymentMethods] = await Promise.all([
    listTreasuryLedgerAccounts(ctx.company.id),
    listUnlinkedPaymentMethods(ctx.company.id),
  ]);
  const isProvider = (await searchParams).kind === "provider";

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title={isProvider ? "Nueva pasarela de pago" : "Nueva cuenta bancaria"}
        description={`Añade una cuenta operativa para ${ctx.company.name}.`}
        backHref="/treasury"
        backLabel="Volver a tesorería"
      />

      <PageSection title="Datos de la cuenta" description="Cuenta bancaria o pasarela de pago (Stripe, PayPal…) y la subcuenta contable donde se registrarán sus cobros, pagos y movimientos.">
        {canWriteTreasury ? (
          <CreateBankAccountForm defaultKind={isProvider ? "PAYMENT_PROVIDER" : "BANK"} ledgerAccounts={ledgerAccounts} redirectHref="/treasury/bank-accounts" unlinkedPaymentMethods={unlinkedPaymentMethods} />
        ) : (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear cuentas bancarias." />
        )}
      </PageSection>
    </PageShell>
  );
}
