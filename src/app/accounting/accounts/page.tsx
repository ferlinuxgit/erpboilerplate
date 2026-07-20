import Link from "next/link";

import { AccountsList } from "@/components/accounting/accounts-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireContext } from "@/lib/current-context";
import { can } from "@/lib/rbac";
import { listAccounts } from "@/server/accounting/service";

export default async function AccountsPage() {
  const ctx = await requireContext("accounting.read");
  const accounts = await listAccounts(ctx.company.id);
  const canManage = can(ctx.membership.role, "accounting.write");

  return (
    <PageShell>
      <PageHeader
        eyebrow="Contabilidad"
        title="Plan contable"
        description={`${accounts.length} cuentas organizadas por código, naturaleza y saldo.`}
        backHref="/accounting"
        backLabel="Volver al resumen"
        actions={
          canManage ? (
            <Link className={buttonVariants()} href="/accounting/accounts/new">
              Nueva cuenta
            </Link>
          ) : null
        }
      />
      <PageSection
        title="Cuentas"
        description="Consulta saldos, abre el libro mayor y administra las cuentas manuales."
      >
        <AccountsList canManage={canManage} rows={accounts} />
      </PageSection>
    </PageShell>
  );
}
