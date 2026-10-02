import Link from "next/link";

import { BankAccountsList } from "@/components/treasury/bank-accounts-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listBankAccounts } from "@/server/treasury/service";

export default async function BankAccountsPage() {
  const ctx = await requireContext("treasury.read");
  const rows = await listBankAccounts(ctx.company.id);
  const canManage = can(ctx.membership.role, "treasury.write");
  return (
    <PageShell>
      <PageHeader
        eyebrow="Tesorería"
        title="Cuentas bancarias"
        description="Bancos y pasarelas de pago (Stripe, PayPal…) de la empresa, cada uno con su subcuenta contable."
        backHref="/treasury"
        backLabel="Volver al resumen"
        actions={
          canManage ? (
            <>
              <Link className={buttonVariants({ variant: "outline" })} href="/treasury/bank-accounts/new?kind=provider">
                Nueva pasarela de pago
              </Link>
              <Link className={buttonVariants()} href="/treasury/bank-accounts/new">
                Nueva cuenta
              </Link>
            </>
          ) : null
        }
      />
      <PageSection
        title="Cuentas"
        description="Busca por nombre o IBAN y abre el detalle de cada cuenta."
      >
        <BankAccountsList canManage={canManage} rows={rows} />
      </PageSection>
    </PageShell>
  );
}
