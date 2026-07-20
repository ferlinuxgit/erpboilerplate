import Link from "next/link";

import { BankTransactionsList } from "@/components/treasury/bank-transactions-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import {
  listBankAccounts,
  listBankTransactions,
} from "@/server/treasury/service";

export default async function BankTransactionsPage() {
  const ctx = await requireContext("treasury.read");
  const [accounts, rows] = await Promise.all([
    listBankAccounts(ctx.company.id),
    listBankTransactions(ctx.company.id),
  ]);
  const canManage = can(ctx.membership.role, "treasury.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Movimientos bancarios"
        description="Histórico bancario, importes y estado de conciliación."
        backHref="/treasury"
        backLabel="Volver al resumen"
        actions={
          canManage ? (
            <Link
              className={buttonVariants()}
              href="/treasury/bank-transactions/new"
            >
              Nuevo movimiento
            </Link>
          ) : null
        }
      />
      <PageSection
        title="Movimientos"
        description="Filtra por cuenta o estado, ordena y exporta el extracto."
      >
        <BankTransactionsList
          accounts={accounts}
          canManage={canManage}
          currencyCode={ctx.company.baseCurrencyCode}
          rows={rows}
        />
      </PageSection>
    </PageShell>
  );
}
