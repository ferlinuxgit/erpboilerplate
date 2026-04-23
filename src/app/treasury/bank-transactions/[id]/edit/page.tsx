import { notFound } from "next/navigation";

import { EditBankTransactionForm } from "@/components/treasury/edit-bank-transaction-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="container mx-auto px-4 py-10">
      <Card>
        <CardHeader><CardTitle>Editar movimiento bancario</CardTitle></CardHeader>
        <CardContent>
          <EditBankTransactionForm
            id={transaction.id}
            accounts={accounts}
            defaultBankAccountId={transaction.bankAccountId}
            defaultAmount={transaction.amount.toString()}
            defaultDescription={transaction.description}
            defaultPostedAt={transaction.postedAt.toISOString().slice(0, 10)}
          />
        </CardContent>
      </Card>
    </main>
  );
}
