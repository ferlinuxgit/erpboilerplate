import { notFound } from "next/navigation";

import { EditBankAccountForm } from "@/components/treasury/edit-bank-account-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getBankAccount, listTreasuryLedgerAccounts } from "@/server/treasury/service";

export default async function EditBankAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) notFound();
  const { id } = await params;
  const [account, ledgerAccounts] = await Promise.all([getBankAccount(ctx.company.id, id), listTreasuryLedgerAccounts(ctx.company.id)]);
  if (!account) notFound();

  return (
    <PageShell>
      <PageHeader eyebrow="Tesorería" title="Editar cuenta bancaria" description={account.bankName} backHref={`/treasury/bank-accounts/${account.id}`} backLabel="Volver a la cuenta" />
      <PageSection title="Datos bancarios" description="Banco, IBAN y cuenta contable. El cambio de cuenta contable afecta solo a los apuntes nuevos.">
        <EditBankAccountForm
          defaultAccountId={account.accountId}
          defaultBankName={account.bankName}
          defaultIban={account.iban}
          id={account.id}
          ledgerAccounts={ledgerAccounts}
        />
      </PageSection>
    </PageShell>
  );
}
