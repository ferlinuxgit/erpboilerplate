import Link from "next/link";

import { CreateBankTransactionForm } from "@/components/treasury/create-bank-transaction-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listBankAccounts } from "@/server/treasury/service";

export default async function NewBankTransactionPage({ searchParams }: { searchParams?: Promise<{ bankAccountId?: string | string[] }> }) {
  const ctx = await requireContext("treasury.write");
  const query = await searchParams;
  const initialBankAccountId = Array.isArray(query?.bankAccountId) ? query.bankAccountId[0] : query?.bankAccountId;
  const accounts = await listBankAccounts(ctx.company.id);
  const canWriteTreasury = can(ctx.membership.role, "treasury.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Nuevo movimiento"
        description={`Registra una transacción bancaria para ${ctx.company.name}.`}
        backHref="/treasury"
        backLabel="Volver a tesorería"
      />

      <PageSection title="Datos del movimiento" description="Selecciona cuenta, fecha, importe y descripción.">
        {!canWriteTreasury ? (
          <EmptyState title="Solo lectura" description="Tu rol actual no permite crear movimientos bancarios." />
        ) : accounts.length === 0 ? (
          <EmptyState
            title="Falta una cuenta bancaria"
            description="Crea una cuenta antes de registrar movimientos."
            action={
              <Link className={buttonVariants({ variant: "secondary" })} href="/treasury/bank-accounts/new">
                Nueva cuenta
              </Link>
            }
          />
        ) : (
          <CreateBankTransactionForm accounts={accounts} initialBankAccountId={initialBankAccountId} redirectHref={initialBankAccountId ? `/treasury/bank-accounts/${initialBankAccountId}` : "/treasury"} />
        )}
      </PageSection>
    </PageShell>
  );
}
