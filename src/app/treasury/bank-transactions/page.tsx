import Link from "next/link";

import { BankTransactionsList } from "@/components/treasury/bank-transactions-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { parseListParams, type RawSearchParams } from "@/lib/list-params";
import { can } from "@/lib/rbac";
import { toServerListState } from "@/server/lists/paginate";
import { bankTransactionListConfig, listBankTransactionsPage } from "@/server/treasury/bank-transaction-list";
import { listBankAccounts } from "@/server/treasury/service";

export default async function BankTransactionsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const ctx = await requireContext("treasury.read");
  const [accounts, rawParams] = await Promise.all([listBankAccounts(ctx.company.id), searchParams]);
  // The account filter only accepts the company's own accounts.
  const params = parseListParams(rawParams, bankTransactionListConfig(accounts.map((account) => account.id)));
  const result = await listBankTransactionsPage(ctx.company.id, params);
  const canManage = can(ctx.membership.role, "treasury.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Movimientos bancarios"
        description="Histórico del banco. Cada movimiento está «Pendiente de conciliar», «Conciliado» (con su cobro o pago) o «Asignado a cuenta» (comisiones, cuotas, impuestos…)."
        backHref="/treasury"
        backLabel="Volver al resumen"
        actions={
          canManage ? (
            <>
              <Link className={buttonVariants({ variant: "outline" })} href="/treasury/bank-transactions/new">
                Nuevo movimiento
              </Link>
              <Link className={buttonVariants()} href="/treasury/import">
                Importar extracto
              </Link>
            </>
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
          rows={result.rows}
          server={toServerListState(params, result, result.unfilteredTotal)}
        />
      </PageSection>
    </PageShell>
  );
}
