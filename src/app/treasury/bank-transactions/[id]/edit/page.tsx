import { notFound } from "next/navigation";

import { EditBankTransactionForm } from "@/components/treasury/edit-bank-transaction-form";
import { PageHeader, PageSection, PageShell } from "@/components/ui/page";
import { requireUserSession } from "@/lib/current-user";
import { can } from "@/lib/rbac";
import { ensureUserTenant } from "@/lib/tenant";
import { getBankTransaction, listBankAccounts } from "@/server/treasury/service";

export default async function EditBankTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUserSession();
  const ctx = await ensureUserTenant({ id: session.user.id, name: session.user.name });
  if (!can(ctx.membership.role, "treasury.write")) notFound();
  const { id } = await params;
  const transaction = await getBankTransaction(ctx.company.id, id);
  if (!transaction) notFound();
  const accounts = await listBankAccounts(ctx.company.id);

  return (
    <PageShell>
      <PageHeader eyebrow="Tesorería" title="Editar movimiento bancario" description={transaction.description} backHref="/treasury" backLabel="Volver a tesorería" />
      <PageSection title="Datos del movimiento" description="Actualiza cuenta, fecha, importe y descripción.">
        <EditBankTransactionForm
          id={transaction.id}
          accounts={accounts}
          defaultBankAccountId={transaction.bankAccountId}
          defaultAmount={transaction.amount.toString()}
          defaultDescription={transaction.description}
          defaultPostedAt={transaction.postedAt.toISOString().slice(0, 10)}
        />
      </PageSection>
    </PageShell>
  );
}
